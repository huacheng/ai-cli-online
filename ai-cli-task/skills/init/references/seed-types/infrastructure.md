# infrastructure

## Description

DevOps, deployment, CI/CD, containers

## Methodology

Health checks, smoke tests, rollback verification

## Phase Intelligence

### plan

- **Collection Direction**: Architecture topology, service discovery, scaling strategies, security baselines
- **Key Sources**: Cloud provider docs (AWS/GCP/Azure), Terraform registry, CIS benchmarks, 12-factor app methodology
- **Plan Structure**: Topology → provisioning → configuration → health checks
- **Key Considerations**: Rollback strategy, idempotency, secret management, connectivity verification

### verify

- **Collection Direction**: Infrastructure testing, compliance scanning, chaos engineering
- **Key Sources**: Terratest, InSpec, Checkov, Goss, Chaos Monkey, container scanning (Trivy)
- **Quick Checkpoint**: Config syntax valid, dry-run pass
- **Full Checkpoint**: Health check endpoints 200, connectivity tests, rollback + re-deploy, idempotency (apply twice → no diff)
- **Key Tools**: `terraform plan/validate`, `docker compose config`, `ansible --check`, `curl`, `nc`, `systemctl status`

### check

- **Collection Direction**: Security baselines, compliance frameworks, SLA benchmarks
- **Key Sources**: CIS benchmarks, SOC 2 controls, cloud well-architected frameworks, SRE golden signals
- **Indicators**: Deploy, provision, CI/CD, container
- **Verification Approach**: Health checks, connectivity tests, rollback verification, idempotency tests

### exec

- **Collection Direction**: Terraform/Ansible module reference, CLI tools, troubleshooting runbooks
- **Key Sources**: Provider docs, module registries, tool man pages, operations runbooks
- **Implementation Approach**: Run provisioning tools (terraform, docker, ansible, etc.), verify connectivity
- **Step Verification**: Health checks, connectivity tests, idempotency verification
