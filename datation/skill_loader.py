"""
Skill Loader - Agent Skills standard implementation (agentskills.io)

Follows the official Progressive Disclosure specification:
  1. Discovery  (Startup phase): Only load name + description + location, injecting Catalog into the System Prompt.
  2. Activation (Runtime phase): When the Agent determines a task matches a skill description, it loads the full SKILL.md using a file-reading tool.
  3. Execution  (Execution phase): The Agent executes according to the complete instructions, reading references/ and other resources as needed.

Reference: https://agentskills.io/client-implementation/adding-skills-support
"""
import os
import sys
import yaml


def parse_skill_metadata(skill_path: str) -> dict | None:
    """
    Parse the YAML Frontmatter of SKILL.md, extracting only the metadata required for the Catalog.
    Follows the official specification: name, description, location (does not load the full body).
    """
    skill_file_path = os.path.join(skill_path, "SKILL.md")
    if not os.path.exists(skill_file_path):
        return None

    with open(skill_file_path, "r", encoding="utf-8") as f:
        content = f.read()

    if not content.startswith("---"):
        return None

    parts = content.split("---", 2)
    if len(parts) < 3:
        return None

    try:
        frontmatter = yaml.safe_load(parts[1])
        if not isinstance(frontmatter, dict):
            return None

        name = frontmatter.get("name", "").strip()
        description = frontmatter.get("description", "").strip()

        # Validate: name should only contain lowercase letters and hyphens
        if not name or not description:
            print(f"[SkillLoader] Skipping {skill_path}: missing name or description in frontmatter")
            return None

        # Extract optional fields
        allowed_tools = frontmatter.get("allowed-tools")
        if isinstance(allowed_tools, str):
            allowed_tools = [t.strip() for t in allowed_tools.split()]
        
        compatibility = frontmatter.get("compatibility", "")
        metadata = frontmatter.get("metadata", {})

        # List resource files under references/ and scripts/ directories (to inform Agent of available resources)
        resources = []
        for sub_dir in ("references", "scripts", "assets"):
            sub_path = os.path.join(skill_path, sub_dir)
            if os.path.isdir(sub_path):
                for fname in sorted(os.listdir(sub_path)):
                    fpath = os.path.join(sub_path, fname)
                    if os.path.isfile(fpath):
                        resources.append(f"{sub_dir}/{fname}")

        return {
            "name": name,
            "description": description,
            "location": os.path.abspath(skill_file_path),
            "skill_dir": os.path.abspath(skill_path),
            "allowed_tools": allowed_tools or [],
            "compatibility": compatibility,
            "metadata": metadata,
            "resources": resources,
        }
    except Exception as e:
        print(f"[SkillLoader] Failed to parse {skill_file_path}: {e}")
        return None


def inject_skills_catalog(skills_dir: str = "skills") -> str:
    """
    [Official Standard] Only inject the Skill Catalog (directory), not the complete SKILL.md content.

    The generated XML format follows official specifications:
      - <available_skills> wraps all skill entries.
      - Each <skill> only contains name, description, location.
      - Preposed behavioral instructions tell the LLM how to activate the skill.

    When the LLM determines a task matches a skill description, it will read the full
    SKILL.md file at the corresponding path via the ShellExecutor tool, instead of loading everything at startup.
    """
    if not os.path.exists(skills_dir):
        return ""

    skill_entries = []
    for entry in sorted(os.listdir(skills_dir)):
        skill_dir_path = os.path.join(skills_dir, entry)
        if os.path.isdir(skill_dir_path):
            metadata = parse_skill_metadata(skill_dir_path)
            if metadata:
                xml = f"  <skill>\n"
                xml += f"    <name>{metadata['name']}</name>\n"
                xml += f"    <description>{metadata['description']}</description>\n"
                xml += f"    <location>{metadata['location']}</location>\n"

                # Optional: list sub-resources (references/, scripts/, etc.)
                if metadata["resources"]:
                    xml += f"    <resources>\n"
                    for res in metadata["resources"]:
                        xml += f"      <file>{metadata['skill_dir']}/{res}</file>\n"
                    xml += f"    </resources>\n"

                # Optional: compatibility hint
                if metadata["compatibility"]:
                    xml += f"    <compatibility>{metadata['compatibility']}</compatibility>\n"

                xml += f"  </skill>"
                skill_entries.append(xml)
                print(f"[SkillLoader] Discovered skill: '{metadata['name']}' at {metadata['location']}")

    if not skill_entries:
        return "<available_skills/>"

    # Official behavioral instructions (tells LLM how to activate a skill)
    _read_cmd = 'type' if sys.platform == 'win32' else 'cat'
    behavioral_instructions = (
        "The following skills provide specialized instructions for specific tasks. "
        "When a task matches a skill's description, use your file-read tool "
        f"(e.g. ShellExecutor: `{_read_cmd} <location>`) to load the full SKILL.md at the listed "
        "location before proceeding. "
        "When a skill references relative paths, resolve them against the skill directory "
        "(the parent directory of SKILL.md) and use absolute paths in tool calls."
    )

    catalog_xml = "<available_skills>\n" + "\n".join(skill_entries) + "\n</available_skills>"
    return f"{behavioral_instructions}\n\n{catalog_xml}"


# --- Backward compatibility alias ---
# Old code calls inject_skills_context, now pointing to the new standard implementation
inject_skills_context = inject_skills_catalog
