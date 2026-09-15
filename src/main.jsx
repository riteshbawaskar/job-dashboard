import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const ALL_COLUMNS = [
  ["job_name", "Job Name"],
  ["product_id", "Product ID"],
  ["entity_id", "Entity ID"],
  ["status", "Status"],
  ["reporting_date", "Reporting Date"],
  ["start_time", "Start Time"],
  ["end_time", "End Time"],
  ["row_count", "Row Count"],
  ["job_log_id", "Job Log ID"],
  ["scheduler_job_id", "Scheduler Job ID"]
];

async function api(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function App() {
  const [config, setConfig] = useState(null);
  const [dates, setDates] = useState([]);
  const [reportingDate, setReportingDate] = useState("");
  const [filters, setFilters] = useState({
    product_id: "",
    entity_id: "",
    status: "",
    job_name: ""
  });
  const [data, setData] = useState({
    jobs: [],
    summary: {},
    totalRows: 0,
    totalJobs: 0
  });
  const [visibleColumns, setVisibleColumns] = useState([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadJobs(targetPage = page) {
    if (!reportingDate) return;

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        reporting_date: reportingDate,
        page: String(targetPage),
        pageSize: String(config?.defaultPageSize || 25)
      });

      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const result = await api(`/api/jobs?${params}`);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([api("/api/config"), api("/api/reporting-dates")])
      .then(([cfg, dateData]) => {
        setConfig(cfg);
        setVisibleColumns(cfg.defaultColumns);
        setDates(dateData.dates);
        setReportingDate(dateData.latest || "");
      })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (reportingDate && config) loadJobs(page);
  }, [reportingDate, filters, page, config]);

  const totalPages = Math.max(
    1,
    Math.ceil((data.totalRows || 0) / (data.pageSize || 25))
  );

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

  const toggleColumn = key => {
    setVisibleColumns(current =>
      current.includes(key)
        ? current.filter(x => x !== key)
        : [...current, key]
    );
  };

  const clearFilters = () => {
    setFilters({
      product_id: "",
      entity_id: "",
      status: "",
      job_name: ""
    });
    setPage(1);
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="eyebrow">OPERATIONS</div>
          <h1>Batch Job Dashboard</h1>
          <p>Monitor batch execution status and latest runs.</p>
        </div>
        <button className="primary" onClick={() => loadJobs(page)}>↻ Refresh</button>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="card filters">
        <Field label="Reporting Date">
          <select value={reportingDate}
            onChange={e => { setReportingDate(e.target.value); setPage(1); }}>
            {dates.map(d => <option key={d}>{d}</option>)}
          </select>
        </Field>

        <Field label="Product ID">
          <select value={filters.product_id}
            onChange={e => updateFilter("product_id", e.target.value)}>
            <option value="">All</option>
            {[...new Set(data.jobs.map(x => x.product_id).filter(Boolean))].sort()
              .map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>

        <Field label="Entity ID">
          <select value={filters.entity_id}
            onChange={e => updateFilter("entity_id", e.target.value)}>
            <option value="">All</option>
            {[...new Set(data.jobs.map(x => x.entity_id).filter(Boolean))].sort()
              .map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>

        <Field label="Status">
          <select value={filters.status}
            onChange={e => updateFilter("status", e.target.value)}>
            <option value="">All</option>
            {[...new Set(data.jobs.map(x => x.status).filter(Boolean))].sort()
              .map(x => <option key={x}>{x}</option>)}
          </select>
        </Field>

        <Field label="Job Name">
          <input
            placeholder="Search job..."
            value={filters.job_name}
            onChange={e => updateFilter("job_name", e.target.value)}
          />
        </Field>

        <button className="secondary clear" onClick={clearFilters}>Clear</button>
      </section>

      <section className="kpis">
        <Kpi title="Total Jobs" value={data.totalJobs} detail="All jobs for selected date" />
        <Kpi title="Successful" value={data.summary?.successful} detail="Completed successfully" />
        <Kpi title="Failed" value={data.summary?.failed} detail="Failed / error jobs" />
        <Kpi title="Running" value={data.summary?.running} detail="Currently running" />
      </section>

      <section className="card table-card">
        <div className="table-head">
          <div>
            <h2>Job Details</h2>
            <small>{data.totalRows || 0} matching records</small>
          </div>

          <div className="column-picker">
            <button className="secondary" onClick={() => setColumnsOpen(v => !v)}>
              ⚙ Columns
            </button>

            {columnsOpen && (
              <div className="column-menu">
                {ALL_COLUMNS.map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(key)}
                      onChange={() => toggleColumn(key)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {ALL_COLUMNS
                  .filter(([key]) => visibleColumns.includes(key))
                  .map(([key, label]) => <th key={key}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="empty" colSpan={visibleColumns.length}>Loading...</td></tr>
              ) : data.jobs.length === 0 ? (
                <tr><td className="empty" colSpan={visibleColumns.length}>No jobs found.</td></tr>
              ) : data.jobs.map((job, index) => (
                <tr key={`${job.job_log_id || job.job_name}-${index}`}>
                  {ALL_COLUMNS
                    .filter(([key]) => visibleColumns.includes(key))
                    .map(([key]) => (
                      <td key={key}>
                        {key === "status"
                          ? <Status value={job[key]} />
                          : (job[key] ?? "—")}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span>Page {page} of {totalPages}</span>
          <div>
            <button className="secondary" disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}>Previous</button>
            <button className="secondary" disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function Kpi({ title, value, detail }) {
  return (
    <div className="card kpi">
      <span>{title}</span>
      <strong>{value ?? 0}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Status({ value }) {
  const s = String(value || "").toLowerCase();
  const type = ["success", "succeeded", "completed", "complete"].includes(s)
    ? "success"
    : ["failed", "failure", "error"].includes(s)
      ? "failed"
      : ["running", "in_progress", "in progress"].includes(s)
        ? "running" : "neutral";

  return <span className={`status ${type}`}>{value || "—"}</span>;
}

export default App;
