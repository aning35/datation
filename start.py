"""
Cross-platform start script for Datation Application.
This script starts both the Python backend and the Vite frontend simultaneously.
Port priority: app.json > environment variable (.env) > default value.
"""
import os
import sys
import json
import subprocess
import time

APP_CONFIG_PATH = os.path.expanduser("~/.datation/config/app.json")

def load_port_config():
    """Read port configuration: app.json > env var > default."""
    api_port = 18321
    web_port = 1420

    # 1. Read from app.json (highest priority)
    if os.path.exists(APP_CONFIG_PATH):
        try:
            with open(APP_CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            if cfg.get("api_port"):
                api_port = int(cfg["api_port"])
            if cfg.get("web_port"):
                web_port = int(cfg["web_port"])
            return api_port, web_port
        except Exception as e:
            print(f"[WARN] Failed to read app.json: {e}")

    # 2. Fall back to environment variables (including .env)
    if os.path.exists(".env"):
        try:
            with open(".env", 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        os.environ.setdefault(key.strip(), val.strip())
        except Exception:
            pass

    api_port = int(os.environ.get("API_PORT", api_port))
    web_port = int(os.environ.get("WEB_PORT", web_port))

    return api_port, web_port


def main():
    if not os.path.exists("datation/main.py") or not os.path.exists("frontend/package.json"):
        print("Please run this script from the root of the datation project.")
        sys.exit(1)

    # Check dependencies
    import shutil
    if not shutil.which("uv"):
        print("[ERROR] uv is not installed. Please visit https://docs.astral.sh/uv/ to install.")
        sys.exit(1)
    if not shutil.which("node"):
        print("[ERROR] Node.js is not installed. Please visit https://nodejs.org/ to install.")
        sys.exit(1)

    api_port, web_port = load_port_config()
    print(f"=== Starting Datation Application ===")
    print(f"[Config] Backend port: {api_port} | Frontend port: {web_port}")

    # 1. Install Python dependencies
    print("[1/4] Installing Python dependencies (uv sync)...")
    uv_cmd = "uv.exe" if sys.platform == "win32" and not shutil.which("uv") and shutil.which("uv.exe") else "uv"
    result = subprocess.run([uv_cmd, "sync"], capture_output=False)
    if result.returncode != 0:
        print("[ERROR] Failed to install Python dependencies.")
        sys.exit(1)

    # 2. Install frontend dependencies
    print("[2/4] Installing frontend dependencies (npm install)...")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    result = subprocess.run([npm_cmd, "install"], cwd="frontend", capture_output=False)
    if result.returncode != 0:
        print("[ERROR] Failed to install frontend dependencies.")
        sys.exit(1)

    # 3. Start the python backend
    print("[3/4] Starting Python backend (uv run)...")
    
    backend_cmd = ["uv", "run", "python", "-m", "datation.main"]
    if sys.platform == "win32":
        backend_cmd[0] = "uv.exe" if os.path.exists("uv.exe") else "uv"
        
    env = os.environ.copy()
    env["PYTHONPATH"] = os.path.join(os.getcwd(), "datation") + os.pathsep + env.get("PYTHONPATH", "")
    backend_proc = subprocess.Popen(backend_cmd, env=env)

    # Wait for backend to be fully ready
    print(f"[3/4] Waiting for backend to be ready (port {api_port})...")
    import urllib.request
    for i in range(60):
        time.sleep(2)
        if backend_proc.poll() is not None:
            print("Backend failed to start. Exiting.")
            sys.exit(1)
        try:
            with urllib.request.urlopen(f"http://localhost:{api_port}/health", timeout=2) as resp:
                data = json.loads(resp.read().decode())
                if data.get("ready"):
                    print("[OK] Backend is fully ready.")
                    break
        except Exception:
            pass

    # 4. Start the Vite server
    print(f"[4/4] Starting Vite (npm run dev, port {web_port})...")
    vite_cmd = [npm_cmd, "run", "dev"]

    vite_env = os.environ.copy()
    vite_env["VITE_PORT"] = str(web_port)

    try:
        vite_proc = subprocess.Popen(vite_cmd, cwd="frontend", env=vite_env)
        
        print(f"\n=== Datation is running ===")
        print(f"Web UI:   http://localhost:{web_port}")
        print(f"Backend:  http://localhost:{api_port}")
        print()

        # Keep the script running
        while True:
            time.sleep(1)
            if backend_proc.poll() is not None:
                print("Backend process terminated.")
                break
            if vite_proc.poll() is not None:
                print("Vite process terminated.")
                break
    except KeyboardInterrupt:
        print("\nKeyboardInterrupt received. Shutting down...")
    finally:
        # Cleanup
        if backend_proc.poll() is None:
            print("Terminating backend process...")
            backend_proc.terminate()
            try:
                backend_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                backend_proc.kill()
        
        if 'vite_proc' in locals() and vite_proc.poll() is None:
            print("Terminating vite process...")
            vite_proc.terminate()
            
        print("=== Datation Terminated ===")

if __name__ == "__main__":
    main()
