SELECT
    job_name,
    product_id,
    entity_id,
    status,
    reporting_date,
    start_time,
    end_time,
    row_count,
    job_log_id,
    scheduler_job_id
FROM YOUR_DATABASE.YOUR_SCHEMA.YOUR_JOB_LOG_TABLE
WHERE 1 = 1
