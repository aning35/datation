"""
Shell Executor Tool - Secure local Shell command execution tool.

Security Policies:
  1. Command Blacklist: Intercept destructive/high-risk commands.
  2. Timeout Control: Maximum 60 seconds per command execution.
  3. Output Truncation: stdout/stderr capped at 10000 characters.
  4. Working Directory Limitation: Executes in a specified directory by default.
"""

import asyncio
import os
import re
import subprocess
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field


# ============ Security Configuration ============

MAX_TIMEOUT = 60  # seconds
MAX_OUTPUT_CHARS = 10000

# Regex blacklist for dangerous commands (case-insensitive matching)
BLOCKED_PATTERNS = [
    r"\brm\s+(-\w*)?r\w*\s+/\s*$",       # rm -rf /
    r"\bmkfs\b",                         # Format disk
    r"\bdd\s+",                          # Low-level disk write
    r"\bshutdown\b",                     # Shutdown
    r"\breboot\b",                       # Reboot
    r"\bhalt\b",                         # Halt
    r"\binit\s+[06]\b",                  # Switch runlevel
    r":\(\)\s*\{.*:\|:",                 # Fork bomb
    r"\bchmod\s+.*777\s+/",              # Modify global permissions
    r"\bchown\s+.*\s+/\s*$",             # Change global ownership
    r"\bcurl\b.*\|\s*(ba)?sh",           # Execute remote script via pipe
    r"\bwget\b.*\|\s*(ba)?sh",           # Execute remote script via pipe
    r">\s*/dev/sd[a-z]",                 # Write to raw device
    r"\bsystemctl\s+(stop|disable)",     # Stop system service
    r"\bkillall\b",                      # Kill multiple processes
    r"\bpkill\s+-9",                     # Force kill process
    r"\bdel\s+(/s|/q)",                  # Windows recursive deletion
    r"\brmdir\s+(/s|/q)",                # Windows remove directory
    r"\bformat\s+[a-z]:",                # Windows format disk
    r"\bStop-Process\b",                 # PowerShell kill process
    r"\bRemove-Item\s+-Recurse\b",       # PowerShell recursive deletion
]

_blocked_re = [re.compile(p, re.IGNORECASE) for p in BLOCKED_PATTERNS]


# ============ Schema ============

class ShellCommandInput(BaseModel):
    command: str = Field(
        description="The shell command to execute, e.g., ls -la, cat file.txt, wc -l *.csv"
    )


# ============ Core Logic ============

def validate_command(command: str) -> str | None:
    """
    Validate the security of the command. Returns None if passed, or a string describing the reason for rejection.
    """
    stripped = command.strip()
    if not stripped:
        return "Command cannot be empty"

    for pattern in _blocked_re:
        if pattern.search(stripped):
            return f"Security policy rejection: command matches a dangerous pattern ({pattern.pattern})"

    return None


def _truncate(text: str, max_chars: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n...[Output truncated, total {len(text)} characters, showing first {max_chars} characters]"


def run_shell(command: str, cwd: str = ".", timeout: int = MAX_TIMEOUT) -> str:
    """
    Safely execute a shell command in a subprocess and return the result.
    """
    # Security validation
    rejection = validate_command(command)
    if rejection:
        return f"❌ {rejection}"

    # Ensure working directory exists
    abs_cwd = os.path.abspath(cwd)
    os.makedirs(abs_cwd, exist_ok=True)

    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=abs_cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        parts = []
        if stdout:
            parts.append(_truncate(stdout))
        if stderr:
            parts.append(f"[stderr]:\n{_truncate(stderr)}")
        if result.returncode != 0:
            parts.append(f"[exit code]: {result.returncode}")

        return "\n".join(parts) if parts else "(Command execution completed with no output)"

    except subprocess.TimeoutExpired:
        return f"❌ Command execution timed out (maximum {timeout} seconds). Please simplify the command or narrow the processing scope."
    except Exception as e:
        return f"❌ Execution error: {type(e).__name__}: {str(e)}"


# ============ Factory Function ============

def build_shell_executor_tool(cwd: str = "~/.datation/workspaces") -> StructuredTool:
    """
    Create a secure local shell command execution tool.

    Features:
    - Dangerous command blacklist interception
    - 60-second timeout protection
    - Automatic output truncation
    - Execution within a specified working directory
    """
    cwd = os.path.expanduser(cwd)

    def _get_dynamic_cwd() -> str:
        # If cwd is the default workspace root directory, attempt to extract thread_id to construct the actual subdirectory.
        from tools.data_computation.sandbox import sandbox_thread_id
        thread_id = sandbox_thread_id.get(None)
        
        # [FIX] Strictly validate thread_id. If ID is None or "unknown", it indicates no proper session context.
        # In this case, we should never execute commands in the workspaces root directory, as it would expose all session lists.
        if not thread_id or thread_id == "unknown":
            is_workspace_root = os.path.basename(os.path.abspath(cwd)) == "workspaces"
            if is_workspace_root:
                print(f"[Warning] ShellExecutor called in workspaces root WITHOUT thread_id. Isolation failed.")
                # Return a dummy path or prohibit execution
                return os.path.join(cwd, "invalid_session_context")
            return cwd

        if os.path.basename(os.path.abspath(cwd)) == "workspaces":
            # Enter the outputs subdirectory so LLM's 'ls run_X/' can work directly
            return os.path.join(cwd, f"thread_{thread_id}", "outputs")
        return cwd

    def _run_sync(command: str) -> str:
        return run_shell(command, cwd=_get_dynamic_cwd())

    async def _run_async(command: str) -> str:
        import asyncio
        cwd = _get_dynamic_cwd()
        return await asyncio.to_thread(run_shell, command, cwd)

    return StructuredTool(
        name="ShellExecutor",
        description=(
            "Execute shell commands on the local system to inspect files, "
            "Perform command-line operations (uses 'cmd.exe' on Windows by default or 'curl'/'grep'/etc. depending on the OS environment). "
            "Examples for Unix: 'ls -la', 'cat data.csv', 'df -h'. "
            "Examples for Windows: 'dir', 'type data.csv'. "
            "Dangerous commands (rm -rf /, format, shutdown, etc.) are blocked for safety."
        ),
        func=_run_sync,
        coroutine=_run_async,
        args_schema=ShellCommandInput,
    )
