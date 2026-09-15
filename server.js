import "dotenv/config";
import express from "express";
import cors from "cors";
import snowflake from "snowflake-sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";

function required(name) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return process.env[name];
}

const queryFile = path.resolve(
  __dirname,
  process.env.JOB_SQL_QUERY_FILE || "./config/job-query.sql"
);

const JOB_SQL_QUERY = fs.readFileSync(queryFile, "utf8")
  .trim()
  .replace(/;+\s*$/, "");

const DEFAULT_COLUMNS = (process.env.DEFAULT_COLUMNS ||
  "job_name,product_id,entity_id,status,reporting_date,start_time,end_time,row_count")
  .split(",").map(v => v.trim()).filter(Boolean);

const DEFAULT_PAGE_SIZE = Number(process.env.DEFAULT_PAGE_SIZE || 25);
const MAX_PAGE_SIZE = Number(process.env.MAX_PAGE_SIZE || 200);

const sf = {
  account: required("SNOWFLAKE_ACCOUNT"),
  username: required("SNOWFLAKE_USERNAME"),
  database: required("SNOWFLAKE_DATABASE"),
  schema: required("SNOWFLAKE_SCHEMA"),
  warehouse: required("SNOWFLAKE_WAREHOUSE"),
  role: process.env.SNOWFLAKE_ROLE,
  authMethod: (process.env.SNOWFLAKE_AUTH_METHOD || "PAT").toUpperCase(),
  pat: process.env.SNOWFLAKE_PAT
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(x => x.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Same-origin requests have no Origin header.
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS origin not allowed"));
  }
}));
app.use(express.json());

let connectionPromise;

function connectSnowflake() {
  const options = {
    account: sf.account,
    username: sf.username,
    database: sf.database,
    schema: sf.schema,
    warehouse: sf.warehouse,
    ...(sf.role ? { role: sf.role } : {})
  };

  if (sf.authMethod === "PAT") {
    if (!sf.pat) throw new Error("SNOWFLAKE_PAT is required when SNOWFLAKE_AUTH_METHOD=PAT");
    options.token = sf.pat;
    options.authenticator = "oauth";
  } else if (sf.authMethod === "SSO") {
    options.authenticator = "externalbrowser";
  } else {
    throw new Error(`Unsupported SNOWFLAKE_AUTH_METHOD: ${sf.authMethod}`);
  }

  const connection = snowflake.createConnection(options);

  return new Promise((resolve, reject) => {
    connection.connect((err, conn) => {
      if (err) return reject(err);
      resolve(conn);
    });
  });
}

async function getConnection() {
  if (!connectionPromise) {
    connectionPromise = connectSnowflake().catch(err => {
      connectionPromise = undefined;
      throw err;
    });
  }
  return connectionPromise;
}

async function execute(sqlText, binds = []) {
  const connection = await getConnection();
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (err, stmt, rows) => {
        if (err) {
          connectionPromise = undefined;
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    });
  });
}

const columns = {
  job_name: "JOB_NAME",
  product_id: "PRODUCT_ID",
  entity_id: "ENTITY_ID",
  status: "STATUS",
  reporting_date: "REPORTING_DATE",
  start_time: "START_TIME",
  end_time: "END_TIME",
  row_count: "ROW_COUNT",
  job_log_id: "JOB_LOG_ID",
  scheduler_job_id: "SCHEDULER_JOB_ID"
};

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeRows(rows) {
  return rows.map(r => ({
    job_name: r.JOB_NAME,
    product_id: r.PRODUCT_ID,
    entity_id: r.ENTITY_ID,
    status: r.STATUS,
    reporting_date: normalizeDate(r.REPORTING_DATE),
    start_time: r.START_TIME,
    end_time: r.END_TIME,
    row_count: r.ROW_COUNT,
    job_log_id: r.JOB_LOG_ID,
    scheduler_job_id: r.SCHEDULER_JOB_ID
  }));
}

function addFilter(clauses, binds, column, value) {
  if (value === undefined || value === null || value === "") return;

  const values = Array.isArray(value)
    ? value.filter(Boolean)
    : [value];

  if (!values.length) return;

  clauses.push(`${columns[column]} IN (${values.map(() => "?").join(", ")})`);
  binds.push(...values);
}

function buildWhere(query, binds) {
  const clauses = [];

  addFilter(clauses, binds, "reporting_date", query.reporting_date);
  addFilter(clauses, binds, "product_id", query.product_id);
  addFilter(clauses, binds, "entity_id", query.entity_id);
  addFilter(clauses, binds, "status", query.status);

  if (query.job_name) {
    clauses.push("JOB_NAME ILIKE ?");
    binds.push(`%${query.job_name}%`);
  }

  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "batch-job-dashboard" });
});

app.get("/api/config", (_req, res) => {
  res.json({
    defaultColumns: DEFAULT_COLUMNS,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    maxPageSize: MAX_PAGE_SIZE
  });
});

app.get("/api/reporting-dates", async (_req, res) => {
  try {
    const sql = `
      SELECT DISTINCT REPORTING_DATE
      FROM (${JOB_SQL_QUERY}) Q
      WHERE REPORTING_DATE IS NOT NULL
      ORDER BY REPORTING_DATE DESC
    `;

    const rows = await execute(sql);
    const dates = rows.map(r => normalizeDate(r.REPORTING_DATE)).filter(Boolean);

    res.json({ dates, latest: dates[0] || null });
  } catch (err) {
    console.error("Reporting dates error:", err);
    res.status(500).json({
      error: "Unable to retrieve reporting dates.",
      detail: err.message
    });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(req.query.pageSize || DEFAULT_PAGE_SIZE))
    );
    const offset = (page - 1) * pageSize;

    const binds = [];
    const where = buildWhere(req.query, binds);
    const filteredQuery = `SELECT * FROM (${JOB_SQL_QUERY}) Q ${where}`;

    const countRows = await execute(
      `SELECT COUNT(*) AS TOTAL_ROWS,
              COUNT(DISTINCT JOB_NAME) AS FILTERED_JOBS
       FROM (${filteredQuery}) F`,
      binds
    );

    const summaryRows = await execute(
      `SELECT
         COUNT(DISTINCT CASE
           WHEN UPPER(STATUS) IN ('SUCCESS','SUCCEEDED','COMPLETED','COMPLETE')
           THEN JOB_NAME END) AS SUCCESSFUL,
         COUNT(DISTINCT CASE
           WHEN UPPER(STATUS) IN ('FAILED','FAILURE','ERROR')
           THEN JOB_NAME END) AS FAILED,
         COUNT(DISTINCT CASE
           WHEN UPPER(STATUS) IN ('RUNNING','IN_PROGRESS','IN PROGRESS')
           THEN JOB_NAME END) AS RUNNING
       FROM (${filteredQuery}) F`,
      binds
    );

    const rows = await execute(
      `SELECT *
       FROM (${filteredQuery}) F
       ORDER BY REPORTING_DATE DESC, START_TIME DESC NULLS LAST
       LIMIT ? OFFSET ?`,
      [...binds, pageSize, offset]
    );

    // Total jobs intentionally ignores Product/Entity/Status/Job Search
    // but respects the selected reporting date.
    const totalBinds = [];
    const totalWhere = buildWhere(
      { reporting_date: req.query.reporting_date },
      totalBinds
    );

    const totalRows = await execute(
      `SELECT COUNT(DISTINCT JOB_NAME) AS TOTAL_JOBS
       FROM (${JOB_SQL_QUERY}) Q
       ${totalWhere}`,
      totalBinds
    );

    res.json({
      page,
      pageSize,
      totalRows: Number(countRows[0]?.TOTAL_ROWS || 0),
      totalJobs: Number(totalRows[0]?.TOTAL_JOBS || 0),
      filteredJobs: Number(countRows[0]?.FILTERED_JOBS || 0),
      summary: {
        successful: Number(summaryRows[0]?.SUCCESSFUL || 0),
        failed: Number(summaryRows[0]?.FAILED || 0),
        running: Number(summaryRows[0]?.RUNNING || 0)
      },
      jobs: normalizeRows(rows)
    });
  } catch (err) {
    console.error("Jobs error:", err);
    res.status(500).json({
      error: "Unable to retrieve job data.",
      detail: err.message
    });
  }
});

// Production: same Node process serves the compiled React SPA.
const distPath = path.resolve(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Batch Job Dashboard listening on http://${HOST}:${PORT}`);
});
