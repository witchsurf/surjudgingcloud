# AGENTS.md

## Overview
This document defines the **Codex agents** used in the `wave-sync-senegal` project. Each agent has a single responsibility, clear inputs and outputs, and defined constraints. Agents are modular and can be extended as the project grows.

---

## Agents

### 1. Project Setup Agent
**Role**: Initialize the repository structure, dependencies, and CI/CD pipeline.  
**Inputs**: Repository config, chosen frameworks (React Native, Node.js, backend services).  
**Outputs**: Project boilerplate, CI/CD scripts.  
**Constraints**: Must follow project coding standards.

---

### 2. Data Sync Agent
**Role**: Handle offline-first data collection and synchronization with the backend.  
**Inputs**: Local storage, API endpoints.  
**Outputs**: Consistent, synced state across devices and servers.  
**Constraints**: Must tolerate unstable network conditions common in Senegal.

---

### 3. Localization Agent
**Role**: Manage translations and context-aware UI rendering.  
**Inputs**: Translation JSON/YAML files.  
**Outputs**: Localized app in French, Wolof, and English.  
**Constraints**: Must support low-bandwidth mode and graceful fallback.

---

### 4. Notification Agent
**Role**: Manage alerts, reminders, and push notifications.  
**Inputs**: User activity, backend triggers.  
**Outputs**: SMS, push, or in-app notifications.  
**Constraints**: Messages must be short and optimized for bandwidth.

---

### 5. Analytics & Reporting Agent
**Role**: Aggregate usage data and generate insights.  
**Inputs**: Logs, user activity data.  
**Outputs**: Dashboards, CSV/PDF reports.  
**Constraints**: Must anonymize sensitive user data.

---

## Best Practices
- Keep agents **modular** — one agent = one job.  
- Use **JSON schemas** for communication between agents.  
- Prefer **stateless design** unless persistent state is required.  
- Log all actions for traceability.  
- Define each agent in `agents/` as `<agent_name>.yaml`.  
