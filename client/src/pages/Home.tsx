import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { FileUploadForm } from "@/components/FileUploadForm";
import { trpc } from "@/lib/trpc";

/**
 * StateBadge — Color-coded badge for job state
 */
function StateBadge({ state }: { state: string }) {
  const stateColors: Record<string, { bg: string; text: string; label: string }> = {
    NEW: { bg: "#e3f2fd", text: "#1976d2", label: "New" },
    CLAIMED: { bg: "#fff3e0", text: "#f57c00", label: "Claimed" },
    RUNNING: { bg: "#f3e5f5", text: "#7b1fa2", label: "Running" },
    DONE: { bg: "#e8f5e9", text: "#388e3c", label: "Done" },
    FAILED: { bg: "#ffebee", text: "#d32f2f", label: "Failed" },
  };

  const config = stateColors[state] || { bg: "#f5f5f5", text: "#666", label: state };

  return (
    <span
      style={{
        display: "inline-block",
        backgroundColor: config.bg,
        color: config.text,
        padding: "0.25rem 0.75rem",
        borderRadius: "4px",
        fontSize: "0.85rem",
        fontWeight: "bold",
      }}
    >
      {config.label}
    </span>
  );
}

/**
 * JobList — Display all jobs with real-time updates
 */
function JobList() {
  const [, navigate] = useLocation();
  const { data: jobsList, isLoading, error, refetch } = trpc.jobs.list.useQuery(
    { limit: 50, offset: 0 },
    { refetchInterval: 2000 } // Poll every 2 seconds
  );

  const retryMutation = trpc.jobs.retry.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handleRetry = (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    retryMutation.mutate({ jobId });
  };

  useEffect(() => {
    console.log("Jobs updated:", jobsList);
  }, [jobsList]);

  if (isLoading) return <div>Loading jobs...</div>;
  if (error) return <div style={{ color: "red" }}>Error loading jobs: {error.message}</div>;

  return (
    <div style={{ padding: "1rem", border: "1px solid #ccc" }}>
      <h2>Jobs ({jobsList?.length || 0})</h2>
      {!jobsList || jobsList.length === 0 ? (
        <p>No jobs yet. Upload an audio file to get started.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Job ID</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>State</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>File</th>
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
                  <StateBadge state={job.state} />
                </td>
                <td style={{ padding: "0.5rem", fontSize: "0.85rem" }}>
                  {job.metadata?.youtubeUrl && job.metadata.youtubeUrl !== "N/A"
                    ? job.metadata.youtubeUrl.substring(0, 50)
                    : "Uploaded file"}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  {job.state === "DONE" && <span style={{ color: "green" }}>✓ Complete</span>}
                  {job.state === "FAILED" && (
                    <div>
                      <span style={{ color: "red" }}>✗ Failed</span>
                      {job.metadata?.download?.reason && (
                        <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Reason: {job.metadata.download.reason}
                        </div>
                      )}
                      <button
                        onClick={(e) => handleRetry(e, job.jobId)}
                        style={{
                          marginTop: "0.5rem",
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.75rem",
                          backgroundColor: "#d32f2f",
                          color: "white",
                          border: "none",
                          borderRadius: "3px",
                          cursor: "pointer",
                        }}
                        disabled={retryMutation.isPending}
                      >
                        {retryMutation.isPending ? "Retrying..." : "Retry"}
                      </button>
                    </div>
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
 * Home — Main page with file upload and job listing
 */
export default function Home() {
  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
      <h1>E.G.O. Studio Audio</h1>
      <p style={{ fontSize: "1.1rem", color: "#666", marginBottom: "2rem" }}>
        Upload your audio. Get studio-ready stems + session files.
      </p>
      <FileUploadForm />
      <JobList />
    </div>
  );
}
