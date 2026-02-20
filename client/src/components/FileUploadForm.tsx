import { useState } from "react";
import { useLocation } from "wouter";

/**
 * FileUploadForm — Upload audio file to create a job
 *
 * Minimal implementation:
 * - File input (WAV, MP3, AIFF, FLAC)
 * - Upload button
 * - Error display
 * - Loading state
 * - Redirect to JobDetail on success
 */
export function FileUploadForm() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
    setError(null); // Clear error when user selects new file
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const data = await res.json();
      console.log("Job created:", data.jobId);

      // Redirect to job detail page
      navigate(`/jobs/${data.jobId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setError(message);
      console.error("Upload error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: "2rem", padding: "1rem", border: "1px solid #ccc" }}>
      <h2>Upload Audio File</h2>
      <p style={{ fontSize: "0.9rem", color: "#666" }}>
        Supported formats: WAV, MP3, AIFF, FLAC (max 200MB)
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <input
          type="file"
          accept=".wav,.mp3,.aiff,.flac,audio/wav,audio/mpeg,audio/aiff,audio/flac"
          onChange={handleFileChange}
          disabled={loading}
          style={{ marginRight: "1rem" }}
        />
        {file && (
          <span style={{ fontSize: "0.9rem", color: "#666" }}>
            Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </span>
        )}
      </div>

      <button
        onClick={handleUpload}
        disabled={!file || loading}
        style={{
          padding: "0.5rem 1rem",
          backgroundColor: file && !loading ? "#1976d2" : "#ccc",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: file && !loading ? "pointer" : "not-allowed",
          fontSize: "1rem",
        }}
      >
        {loading ? "Uploading..." : "Upload & Process"}
      </button>

      {error && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            backgroundColor: "#ffebee",
            color: "#d32f2f",
            borderRadius: "4px",
            fontSize: "0.9rem",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
