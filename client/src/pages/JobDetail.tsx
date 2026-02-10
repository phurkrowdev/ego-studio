import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Job Detail Page
 *
 * Displays:
 * - Job metadata (title, artist, URL, state)
 * - Real-time logs (polling every 2 seconds)
 * - Artifacts (download, separation, lyrics, audacity)
 * - Retry button for FAILED jobs
 */

export function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const [, navigate] = useLocation();
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch job details
  const jobQuery = trpc.jobs.get.useQuery(
    { jobId: jobId || "" },
    { enabled: !!jobId, refetchInterval: autoRefresh ? 2000 : false }
  );

  // Fetch job logs
  const logsQuery = trpc.jobs.logs.useQuery(
    { jobId: jobId || "" },
    { enabled: !!jobId, refetchInterval: autoRefresh ? 2000 : false }
  );

  // Fetch job artifacts
  const artifactsQuery = trpc.jobs.artifacts.useQuery(
    { jobId: jobId || "" },
    { enabled: !!jobId, refetchInterval: autoRefresh ? 2000 : false }
  );

  // Retry mutation
  const retryMutation = trpc.jobs.retry.useMutation({
    onSuccess: () => {
      jobQuery.refetch();
      logsQuery.refetch();
      artifactsQuery.refetch();
    },
  });

  if (!jobId) {
    return (
      <div className="p-6">
        <p>Job ID not found</p>
        <Button onClick={() => navigate("/")}>Back to Jobs</Button>
      </div>
    );
  }

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  if (jobQuery.isLoading) {
    return (
      <div className="p-6">
        <p>Loading job details...</p>
      </div>
    );
  }

  if (jobQuery.error) {
    return (
      <div className="p-6">
        <p className="text-red-600">Error loading job: {jobQuery.error.message}</p>
        <Button onClick={() => handleNavigate("/")}>Back to Jobs</Button>
      </div>
    );
  }

  const job = jobQuery.data;
  if (!job) {
    return (
      <div className="p-6">
        <p>Job not found</p>
        <Button onClick={() => handleNavigate("/")}>Back to Jobs</Button>
      </div>
    );
  }

  const stateColors: Record<string, string> = {
    NEW: "bg-blue-100 text-blue-800",
    CLAIMED: "bg-yellow-100 text-yellow-800",
    RUNNING: "bg-purple-100 text-purple-800",
    DONE: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Button variant="outline" onClick={() => handleNavigate("/")}>
          ← Back to Jobs
        </Button>
      </div>

      {/* Job Metadata */}
      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold mb-2">
              {job.metadata.title || "Untitled Job"}
            </h1>
            <p className="text-gray-600 text-sm mb-2">{job.metadata.youtubeUrl}</p>
            {job.metadata.artist && (
              <p className="text-gray-600 text-sm">Artist: {job.metadata.artist}</p>
            )}
          </div>
          <Badge className={stateColors[job.state] || "bg-gray-100 text-gray-800"}>
            {job.state}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Job ID</p>
            <p className="font-mono text-xs">{job.jobId}</p>
          </div>
          <div>
            <p className="text-gray-600">Created</p>
            <p>{new Date(job.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-600">Updated</p>
            <p>{new Date(job.updatedAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-600">Auto-refresh</p>
            <Button
              size="sm"
              variant={autoRefresh ? "default" : "outline"}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? "On" : "Off"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Logs */}
      <Card className="p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">Logs</h2>
        <div className="bg-gray-900 text-gray-100 p-4 rounded font-mono text-sm max-h-64 overflow-y-auto">
          {logsQuery.isLoading ? (
            <p className="text-gray-500">Loading logs...</p>
          ) : logsQuery.data?.logs && logsQuery.data.logs.length > 0 ? (
            logsQuery.data.logs.map((log, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-words">
                {log}
              </div>
            ))
          ) : (
            <p className="text-gray-500">No logs yet</p>
          )}
        </div>
      </Card>

      {/* Artifacts */}
      {(job.metadata.download || job.metadata.separation || job.metadata.lyrics || job.metadata.audacity) && (
        <Card className="p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">Artifacts</h2>

          {job.metadata.download && (
            <div className="mb-4">
              <p className="font-semibold text-sm">Download</p>
              <p className="text-sm text-gray-600">
                Status: <span className="font-mono">{job.metadata.download.status}</span>
              </p>
              {job.metadata.download.reason && (
                <p className="text-sm text-red-600">Reason: {job.metadata.download.reason}</p>
              )}
              {(job.metadata.download as any)?.title && (
                <p className="text-sm">Title: {(job.metadata.download as any).title}</p>
              )}
              {(job.metadata.download as any)?.artist && (
                <p className="text-sm">Artist: {(job.metadata.download as any).artist}</p>
              )}
              {(job.metadata.download as any)?.duration && (
                <p className="text-sm">Duration: {(job.metadata.download as any).duration}s</p>
              )}
            </div>
          )}

          {job.metadata.separation && (
            <div className="mb-4">
              <p className="font-semibold text-sm">Separation</p>
              <p className="text-sm text-gray-600">
                Status: <span className="font-mono">{job.metadata.separation.status}</span>
              </p>
            </div>
          )}

          {job.metadata.lyrics && (
            <div className="mb-4">
              <p className="font-semibold text-sm">Lyrics</p>
              <p className="text-sm text-gray-600">
                Status: <span className="font-mono">{job.metadata.lyrics.status}</span>
              </p>
            </div>
          )}

          {job.metadata.audacity && (
            <div className="mb-4">
              <p className="font-semibold text-sm">Audacity</p>
              <p className="text-sm text-gray-600">
                Status: <span className="font-mono">{job.metadata.audacity.status}</span>
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Actions */}
      <Card className="p-6">
        <h2 className="text-lg font-bold mb-4">Actions</h2>
        <div className="flex gap-2">
          {job.state === "FAILED" && (
            <Button
              onClick={() => retryMutation.mutate({ jobId: job.jobId })}
              disabled={retryMutation.isPending}
            >
              {retryMutation.isPending ? "Retrying..." : "Retry Job"}
            </Button>
          )}
          {job.state === "NEW" && (
            <Button
              onClick={() =>
                trpc.jobs.simulateProgress.useMutation().mutate({ jobId: job.jobId })
              }
              variant="outline"
            >
              Simulate Progress (Testing)
            </Button>
          )}
          {job.state === "FAILED" && (
            <Button
              onClick={() =>
                trpc.jobs.simulateFailure.useMutation().mutate({
                  jobId: job.jobId,
                  reason: "DOWNLOAD_ERROR",
                })
              }
              variant="outline"
            >
              Simulate Failure (Testing)
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
