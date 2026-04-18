import fs from "fs/promises";
import path from "path";
import { authenticateRequest } from "../../auth";
import {
  createAutoDeploy,
  deleteAutoDeploy,
  getAutoDeploy,
  listAutoDeploys,
  updateAutoDeploy,
  type AutoDeployTrigger,
} from "../../db";
import { requirePermission } from "../../rbac";
import { AUTO_DEPLOY_TRIGGERS, ALLOWED_OS_FILTERS } from "../validation-constants";
import { v4 as uuidv4 } from "uuid";
import type { DeployOs } from "../deploy-utils";

type AutoDeployRouteDeps = {
  DEPLOY_ROOT: string;
  detectUploadOs: (filename: string, bytes: Uint8Array) => DeployOs;
};

export async function handleAutoDeployRoutes(
  req: Request,
  url: URL,
  deps: AutoDeployRouteDeps,
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/auto-deploys") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    return Response.json({ items: listAutoDeploys() });
  }

  if (req.method === "POST" && url.pathname === "/api/auto-deploys") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file" }, { status: 400 });
    }

    const name = String(form.get("name") || "").trim();
    const triggerRaw = String(form.get("trigger") || "").trim() as AutoDeployTrigger;
    const args = String(form.get("args") || "");
    const hideWindow = form.get("hideWindow") !== "false";
    const enabled = form.get("enabled") !== "false";
    let osFilterRaw: string[] = [];
    try {
      osFilterRaw = JSON.parse(String(form.get("osFilter") || "[]"));
    } catch { }
    const osFilter = Array.isArray(osFilterRaw)
      ? osFilterRaw.filter((v: unknown) => typeof v === "string" && ALLOWED_OS_FILTERS.has(v as string))
      : [];

    if (!name) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }
    if (!AUTO_DEPLOY_TRIGGERS.has(triggerRaw)) {
      return Response.json({ error: "Invalid trigger" }, { status: 400 });
    }

    const filename = path.basename(file.name || "upload.bin");
    const id = uuidv4();
    await fs.mkdir(deps.DEPLOY_ROOT, { recursive: true });
    const folder = path.join(deps.DEPLOY_ROOT, "auto", id);
    await fs.mkdir(folder, { recursive: true });
    const targetPath = path.join(folder, filename);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await fs.writeFile(targetPath, bytes);

    const fileOs = deps.detectUploadOs(filename, bytes);

    const item = createAutoDeploy({
      id,
      name,
      trigger: triggerRaw,
      filePath: targetPath,
      fileName: filename,
      fileSize: bytes.length,
      fileOs,
      args,
      hideWindow,
      enabled,
      osFilter,
    });

    return Response.json({ ok: true, item });
  }

  const autoDeployMatch = url.pathname.match(/^\/api\/auto-deploys\/(.+)$/);
  if (autoDeployMatch && req.method === "PUT") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const triggerRaw = body?.trigger ? String(body.trigger).trim() : undefined;
    if (triggerRaw && !AUTO_DEPLOY_TRIGGERS.has(triggerRaw as AutoDeployTrigger)) {
      return Response.json({ error: "Invalid trigger" }, { status: 400 });
    }

    const osFilterRaw = Array.isArray(body?.osFilter) ? body.osFilter : undefined;
    const osFilter = osFilterRaw
      ? osFilterRaw.filter((v: unknown) => typeof v === "string" && ALLOWED_OS_FILTERS.has(v as string))
      : undefined;

    const updated = updateAutoDeploy(autoDeployMatch[1], {
      name: body?.name ? String(body.name).trim() : undefined,
      trigger: triggerRaw as AutoDeployTrigger | undefined,
      args: typeof body?.args === "string" ? body.args : undefined,
      hideWindow: typeof body?.hideWindow === "boolean" ? body.hideWindow : undefined,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
      osFilter,
    });

    if (!updated) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json({ ok: true, item: updated });
  }

  if (autoDeployMatch && req.method === "DELETE") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    const deploy = getAutoDeploy(autoDeployMatch[1]);
    if (deploy) {
      try {
        const dir = path.dirname(deploy.filePath);
        await fs.rm(dir, { recursive: true, force: true });
      } catch { }
    }

    deleteAutoDeploy(autoDeployMatch[1]);
    return Response.json({ ok: true });
  }

  return null;
}
