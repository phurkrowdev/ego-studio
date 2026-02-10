import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * JobSubmitForm — Submit a YouTube URL to create a job
 */
function JobSubmitForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createJobMutation = trpc.jobs.create.useMutation({
    onSuccess: (result: any) => {
      console.log("Job created:", result);
      setUrl("");
      setError(null);
    },
    onError: (err: any) => {
      console.error("Job creation failed:", err);
      setError(err.message);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    setLoading(true);
    try {
      await createJobMutation.mutateAsync({ url: url.trim() });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: "2rem", padding: "1rem", border: "1px solid #ccc" }}>
      <h2>Submit YouTube URL</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "0.5rem" }}>
          <label>
            YouTube URL:
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              style={{ marginLeft: "0.5rem", width: "400px" }}
              disabled={loading}
            />
          </label>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Job"}
        </button>
        {error && <div style={{ color: "red", marginTop: "0.5rem" }}>{error}</div>}
      </form>
    </div>
  );
}

/**
 /**
 * JobList — Display all jobs with real-time updates
 */
function JobList() {
  const [, navigate] = useLocation();
  const { data: jobsList, isLoading, error, refetch } = trpc.jobs.list.useQuery(
    { limit: 50, offset: 0 },
    { refetchInterval: 2000 } // Poll every 2 seconds
  );

  useEffect(() => {
    console.log("Jobs updated:", jobsList);
  }, [jobsList]);

  if (isLoading) return <div>Loading jobs...</div>;
  if (error) return <div style={{ color: "red" }}>Error loading jobs: {error.message}</div>;

  return (
    <div style={{ padding: "1rem", border: "1px solid #ccc" }}>
      <h2>Jobs ({jobsList?.length || 0})</h2>
      {!jobsList || jobsList.length === 0 ? (
        <p>No jobs yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Job ID</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>State</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>URL</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobsList.map((job: any) => (
              <tr
                key={job.jobId}
                style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
                onClick={() => navigate(`/jobs/${job.jobId}`)}
              >
                <td style={{ padding: "0.5rem", fontSize: "0.85rem" }}>
                  {job.jobId.substring(0, 8)}...
                </td>
                <td style={{ padding: "0.5rem" }}>
                  <strong>{job.state}</strong>
                </td>
                <td style={{ padding: "0.5rem", fontSize: "0.85rem" }}>
                  {job.metadata?.youtube_url ? (
                    <a href={job.metadata.youtube_url} target="_blank" rel="noopener noreferrer">
                      {job.metadata.youtube_url.substring(0, 50)}...
                    </a>
                  ) : (
                    "N/A"
                  )}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  {job.state === "DONE" && <span style={{ color: "green" }}>✓ Complete</span>}
                  {job.state === "FAILED" && (
                    <span style={{ color: "red" }}>
                      ✗ Failed
                      {job.metadata?.download?.reason && (
                        <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Reason: {job.metadata.download.reason}
                        </div>
                      )}
                    </span>
                  )}
                  {job.state !== "DONE" && job.state !== "FAILED" && (
                    <span style={{ color: "blue" }}>⟳ {job.state}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={() => refetch()} style={{ marginTop: "1rem" }}>
        Refresh
      </button>
    </div>
  );
}

/**
 * Home — Main page with job submission and listing
 */
export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>E.G.O. Studio Audio — RIF Ingestion</h1>
      <p>Reusable Ingestion Framework for audio processing</p>

      <JobSubmitForm />
      <JobList />

      <div style={{ marginTop: "2rem", padding: "1rem", backgroundColor: "#f5f5f5" }}>
        <h3>Debug Info</h3>
        <p>Check browser console for detailed logs.</p>
      </div>
    </div>
  );
}
