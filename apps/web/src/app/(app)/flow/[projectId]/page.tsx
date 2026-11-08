"use client";

import { use } from "react";
import FlowWorkspace from "@/components/flow/flow-workspace";

/**
 * One project, at its own URL: /flow/<projectId>
 *
 * Rendered inline (no overlay) so the workspace behaves like a page — linkable,
 * refresh-safe, and reachable with the browser back button.
 */
export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <FlowWorkspace projectId={projectId} />;
}
