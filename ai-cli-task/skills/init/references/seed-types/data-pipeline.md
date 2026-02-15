# data-pipeline

## Description

Data transformation, ETL, migration

## Methodology

Schema validation, row counts, data integrity

## Phase Intelligence

### plan

- **Collection Direction**: Schema design, ETL patterns, idempotency strategies, data governance rules
- **Key Sources**: Apache Airflow/dbt docs, data engineering blogs, schema registry specs, GDPR/compliance guides
- **Plan Structure**: Schema mapping → transform logic → validation rules → rollback plan
- **Key Considerations**: Data integrity, idempotency, schema versioning, row count reconciliation

### verify

- **Collection Direction**: Data validation frameworks, schema testing, statistical profiling
- **Key Sources**: Great Expectations, dbt tests, Pandera, Apache Griffin, data profiling tools
- **Quick Checkpoint**: Schema validation pass, sample rows parsed
- **Full Checkpoint**: Row count reconciliation, checksum match, referential integrity, idempotency test (run twice → same result)
- **Key Tools**: `csvkit`, `jq`, `psql/mysql`, `dbt test`, `great_expectations`, `pandas` assertions

### check

- **Collection Direction**: Data quality dimensions, SLA definitions, compliance requirements
- **Key Sources**: DAMA-DMBOK, data quality frameworks, industry-specific compliance (HIPAA/SOX/GDPR)
- **Indicators**: Transform, migrate, import, export, CSV
- **Verification Approach**: Row count validation, schema conformance, data integrity checksums, sample verification

### exec

- **Collection Direction**: SQL patterns, ETL tool recipes, connector configurations, performance tuning
- **Key Sources**: Database docs, dbt macros, Airflow operator reference, query optimization guides
- **Implementation Approach**: Execute transform scripts, validate schemas, verify data integrity
- **Step Verification**: Row count validation, schema conformance, checksum verification
