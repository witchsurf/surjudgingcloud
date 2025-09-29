# wave-sync-senegal Agents

This repository includes an **AGENTS.md** file and predefined agent stubs in the `agents/` folder.

## Contents
- `AGENTS.md`: Documentation of all agents and their roles in the project.
- `agents/`: Folder containing YAML definitions for each agent:
  - `project_setup.yaml`
  - `data_sync.yaml`
  - `localization.yaml`
  - `notification.yaml`
  - `analytics_reporting.yaml`

## Setup Instructions

1. Place `AGENTS.md` in the root of your repository.
2. Copy the `agents/` folder into your project root.
3. Review each YAML file in `agents/` and adjust:
   - Frameworks (e.g., React Native, Node.js, Django).
   - Input/output formats (JSON, CSV, etc.).
   - Constraints specific to your deployment environment.

## Usage
- Use these YAML files as **blueprints** for building your Codex agents.
- Extend or customize as needed by editing definitions.
- Keep `AGENTS.md` updated as a reference for contributors.

## Best Practice
- One agent = one responsibility.
- Communicate between agents using JSON schemas.
- Keep agents stateless unless state is explicitly required.
- Log all agent actions for traceability.

---
⚡ With these stubs, you can bootstrap development quickly and adapt as your app evolves.
