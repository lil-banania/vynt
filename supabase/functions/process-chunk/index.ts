import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Papa from "https://esm.sh/papaparse@5.4.1";

// This function processes a single chunk of a large file analysis
// Called by a cron job or webhook every minute

const CHUNK_SIZE = 1000; // Rows per chunk

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  console.log("[process-chunk] Function invoked");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration missing." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Get next pending chunk
    const { data: chunk, error: fetchError } = await supabase
      .from("analysis_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("[process-chunk] Error fetching chunk:", fetchError);
      return jsonResponse({ error: "Failed to fetch queue" }, 500);
    }

    if (!chunk) {
      console.log("[process-chunk] No pending chunks");
      return jsonResponse({ message: "No pending chunks" });
    }

    console.log(`[process-chunk] Processing chunk ${chunk.chunk_index + 1}/${chunk.total_chunks} for audit ${chunk.audit_id}`);

    // Mark as processing
    await supabase
      .from("analysis_queue")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", chunk.id);

    // Get audit and files
    const { data: files } = await supabase
      .from("uploaded_files")
      .select("id, file_type, file_path")
      .eq("audit_id", chunk.audit_id);

    if (!files || files.length < 2) {
      await supabase
        .from("analysis_queue")
        .update({ status: "error", error_message: "Files not found" })
        .eq("id", chunk.id);
      return jsonResponse({ error: "Files not found" }, 400);
    }

    const file1 = files.find((f) => f.file_type === "usage_logs");
    const file2 = files.find((f) => f.file_type === "stripe_export");

    if (!file1 || !file2) {
      await supabase
        .from("analysis_queue")
        .update({ status: "error", error_message: "Missing file type" })
        .eq("id", chunk.id);
      return jsonResponse({ error: "Missing file type" }, 400);
    }

    // Download and parse files
    const { data: file1Data } = await supabase.storage.from("audit-files").download(file1.file_path);
    const { data: file2Data } = await supabase.storage.from("audit-files").download(file2.file_path);

    if (!file1Data || !file2Data) {
      await supabase
        .from("analysis_queue")
        .update({ status: "error", error_message: "Failed to download files" })
        .eq("id", chunk.id);
      return jsonResponse({ error: "Failed to download files" }, 500);
    }

    const file1Text = await file1Data.text();
    const file2Text = await file2Data.text();

    const file1Result = Papa.parse<Record<string, string>>(file1Text, { header: true, skipEmptyLines: true });
    const file2Result = Papa.parse<Record<string, string>>(file2Text, { header: true, skipEmptyLines: true });

    // Get chunk slice
    const file1Rows = file1Result.data.slice(chunk.file1_start_row, chunk.file1_end_row);
    const file2Rows = file2Result.data.slice(chunk.file2_start_row, chunk.file2_end_row);

    console.log(`[process-chunk] Processing rows: file1[${chunk.file1_start_row}-${chunk.file1_end_row}], file2[${chunk.file2_start_row}-${chunk.file2_end_row}]`);

    // TODO: Process chunk and detect anomalies
    // For now, just mark as completed
    const anomaliesFound = 0; // Will be replaced with actual processing

    // Mark chunk as completed
    await supabase
      .from("analysis_queue")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        anomalies_found: anomaliesFound,
      })
      .eq("id", chunk.id);

    // Update audit progress
    const { data: audit } = await supabase
      .from("audits")
      .select("chunks_completed, chunks_total")
      .eq("id", chunk.audit_id)
      .maybeSingle();

    if (audit) {
      const newCompleted = (audit.chunks_completed ?? 0) + 1;
      
      if (newCompleted >= audit.chunks_total) {
        // All chunks done - aggregate results
        const { data: allChunks } = await supabase
          .from("analysis_queue")
          .select("anomalies_found")
          .eq("audit_id", chunk.audit_id)
          .eq("status", "completed");

        const totalAnomalies = allChunks?.reduce((sum, c) => sum + (c.anomalies_found ?? 0), 0) ?? 0;

        // Get actual anomalies from database
        const { count: anomalyCount } = await supabase
          .from("anomalies")
          .select("*", { count: "exact", head: true })
          .eq("audit_id", chunk.audit_id);

        const { data: anomalies } = await supabase
          .from("anomalies")
          .select("annual_impact")
          .eq("audit_id", chunk.audit_id);

        const annualRevenueAtRisk = anomalies?.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0) ?? 0;

        await supabase
          .from("audits")
          .update({
            status: "review",
            chunks_completed: newCompleted,
            total_anomalies: anomalyCount ?? totalAnomalies,
            annual_revenue_at_risk: annualRevenueAtRisk,
            processed_at: new Date().toISOString(),
          })
          .eq("id", chunk.audit_id);

        console.log(`[process-chunk] Audit ${chunk.audit_id} completed! Total anomalies: ${anomalyCount}`);
      } else {
        await supabase
          .from("audits")
          .update({ chunks_completed: newCompleted })
          .eq("id", chunk.audit_id);
      }
    }

    return jsonResponse({
      success: true,
      chunk: chunk.chunk_index + 1,
      total: chunk.total_chunks,
    });
  } catch (error) {
    console.error("[process-chunk] Error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
