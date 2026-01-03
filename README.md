# TechIT Factory - Application

Microservices monorepo for e-commerce platform.

## Structure
├── services/ │ ├── frontend/ # React SPA │ ├── product/ # Product catalog (Node.js) │ ├── cart/ # Shopping cart (Node.js) │ └── order/ # Order processing (Python) ├── charts/ # Helm charts └── .github/workflows/ # CI/CD per service


## Service Contracts
All services MUST expose:
- `GET /health` → Liveness probe
- `GET /ready` → Readiness probe

## Coming in Sprint 4
- Service implementation
- Dockerfiles
- Helm charts
