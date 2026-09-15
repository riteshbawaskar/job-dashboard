# Batch Job Dashboard — Single Service SPA

A single-service React/Vite + Node/Express application.

There is NO separate frontend service and NO separate backend service.

## Architecture

Development:

Browser -> Vite dev server -> Node API

Production:

Browser -> Node/Express
              ├── serves React SPA
              └── exposes /api/*
                       |
                       v
                   Snowflake

The same Node process serves both the SPA and API in production.

## Setup

```bash
npm install
cp .env.example .env
```

Update `.env` and `config/job-query.sql`.

Run development:

```bash
npm run dev
```

Vite runs the SPA and proxies `/api` to the same Node API process.

For development, start the API separately:

```bash
npm start
```

Then run:

```bash
npm run dev
```

The application is intentionally one deployable service; Vite is only the development/build tool.

## Production

```bash
npm run build
npm start
```

Open:

http://localhost:3001

Express serves `dist/` and `/api/*` from the same process and port.

## Snowflake authentication

PAT:

```env
SNOWFLAKE_AUTH_METHOD=PAT
SNOWFLAKE_PAT=...
```

SSO:

```env
SNOWFLAKE_AUTH_METHOD=SSO
```

SSO uses Snowflake external browser authentication.

## Expected SQL output

The configured query should return:

job_name
product_id
entity_id
status
reporting_date
start_time
end_time
row_count
job_log_id
scheduler_job_id

The API uses the configured query as a subquery and applies reporting-date and UI filters using Snowflake bind parameters.

## Security

- Snowflake credentials never go to the browser.
- `.env` is server-side only.
- Production SPA and API share the same origin, so CORS is not required.
- Optional ALLOWED_ORIGINS can be enabled for development or a reverse-proxy topology.
- User filter values are parameterized.
- Do not commit `.env`.
