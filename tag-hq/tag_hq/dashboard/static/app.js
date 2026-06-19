"use strict";

const $ = (sel) => document.querySelector(sel);

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- self-test pill + reader status ----
async function refreshHealth() {
  const { ok, body } = await getJSON("/api/health");
  const pill = $("#selftest-pill");
  if (ok && body.selftest) {
    pill.textContent = "SELF-TEST ✓";
    pill.className = "pill pill-ok";
    pill.title = "AN12196 Table 30 originality vector verifies.";
  } else {
    pill.textContent = "SELF-TEST ✗";
    pill.className = "pill pill-bad";
  }
}

async function refreshReaders() {
  const el = $("#reader-status");
  const { ok, body } = await getJSON("/api/readers");
  if (ok && body.present) {
    el.textContent = "Reader: " + body.readers.join(", ");
    el.className = "reader-status ok";
  } else {
    el.textContent = "No reader detected — plug in the ACR1252U.";
    el.className = "reader-status bad";
  }
}

// ---- scan ----
async function doScan() {
  const btn = $("#scan-btn");
  btn.disabled = true;
  btn.classList.add("scanning");
  $(".btn-label").textContent = "SCANNING…";
  try {
    const { ok, status, body } = await getJSON("/api/scan", { method: "POST" });
    if (!ok) {
      const d = body.detail || {};
      renderError(d.message || `Scan failed (${status})`, d.kind);
    } else {
      renderResult(body);
      await refreshCatalog();
    }
  } catch (e) {
    renderError(String(e));
  } finally {
    btn.disabled = false;
    btn.classList.remove("scanning");
    $(".btn-label").textContent = "SCAN TAG";
  }
}

function kv(k, v, cls) {
  return `<div class="kv"><span class="k">${esc(k)}</span><span class="v ${cls || ""}">${esc(v)}</span></div>`;
}

function renderError(message, kind) {
  const panel = $("#result");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="verdict-banner notfit">
      <span class="verdict-badge notfit">—</span>
      <div><div class="verdict-headline">${esc(kind === "no_card" ? "No tag on antenna" : kind === "no_reader" ? "No reader" : "Scan error")}</div>
      <div class="verdict-uid">${esc(message)}</div></div>
    </div>`;
}

function renderResult(d) {
  const panel = $("#result");
  panel.classList.remove("hidden");
  const v = d.verdict || {};
  const id = d.identity || {};
  const act = d.activation || {};
  const cc = (d.file_structure || {}).cc || {};
  const ndef = (d.file_structure || {}).ndef || {};
  const keys = d.key_config || {};
  const sdm = d.sdm_sun || {};

  const flags = (v.flags || []).map((f) => `<li>${esc(f)}</li>`).join("");
  const reasons = (v.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const keyRows = Object.entries(keys.versions || {})
    .map(([k, val]) => kv(k, "v" + val, val === 0 ? "warn" : "good")).join("");

  panel.innerHTML = `
    <div class="verdict-banner ${v.fit ? "fit" : "notfit"}">
      <span class="verdict-badge ${v.fit ? "fit" : "notfit"}">${esc(v.badge || "—")}</span>
      <div>
        <div class="verdict-headline">${esc(v.headline || "")}</div>
        <div class="verdict-uid">UID ${esc(d.uid_hex)} · ${esc(d.genuine_label)}</div>
      </div>
    </div>

    ${flags ? `<ul class="flaglist">${flags}</ul>` : ""}

    <div class="grid">
      <div class="card">
        <h4>GENUINENESS · §3</h4>
        ${kv("Verdict", d.genuine_label, d.genuine ? "good" : "bad")}
        ${kv("Detail", d.genuine_reason)}
        ${kv("Signature", d.signature_hex ? d.signature_hex.slice(0, 24) + "…" : "—")}
      </div>
      <div class="card">
        <h4>IDENTITY · GetVersion</h4>
        ${kv("Vendor", id.vendor_id || "—", id.is_nxp ? "good" : "bad")}
        ${kv("Variant", id.variant || d.variant, id.is_gx ? "good" : "warn")}
        ${kv("Gx match", id.is_gx ? "yes" : "no", id.is_gx ? "good" : "warn")}
        ${kv("HW", id.hw || "—")}
        ${kv("UID", id.uid_hex || d.uid_hex)}
      </div>
      <div class="card">
        <h4>ACTIVATION · RF</h4>
        ${kv("ATR", act.atr_hex || "—")}
        ${kv("Reader UID", act.uid_from_reader || "—")}
        ${kv("Random ID", act.random_id ? "YES" : "no", act.random_id ? "warn" : "good")}
      </div>
      <div class="card">
        <h4>FILE STRUCTURE</h4>
        ${kv("CC mapping", cc.mapping_version || "—")}
        ${kv("NDEF file", cc.ndef_file_id || "—")}
        ${kv("NDEF max", cc.ndef_max_size != null ? cc.ndef_max_size + " B" : "—")}
        ${kv("NDEF URI", ndef.uri || "(none)")}
        ${kv("CC write-locked", cc.read_only ? "yes" : "no", cc.read_only ? "good" : "warn")}
      </div>
      <div class="card">
        <h4>KEY CONFIG · ship-state</h4>
        ${kv("State", keys.ship_state || "—", keys.all_default ? "warn" : "good")}
        ${keyRows || kv("Key versions", "unavailable")}
      </div>
      <div class="card">
        <h4>SDM / SUN · crypto</h4>
        ${kv("SDM enabled", sdm.enabled ? "yes" : "no", sdm.enabled ? "good" : "warn")}
        ${kv("NDEF mirror", sdm.ndef_mirror_detected ? "detected" : "none")}
        ${kv("Crypto mode", d.crypto_mode || "—")}
      </div>
    </div>

    <div class="card">
      <h4>VERDICT REASONING</h4>
      <ul class="reasonlist">${reasons}</ul>
    </div>
    ${(d.errors && d.errors.length) ? `<div class="card"><h4>READ NOTES</h4><ul class="reasonlist">${d.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
  `;
}

// ---- catalog ----
async function refreshCatalog() {
  const { ok, body } = await getJSON("/api/catalog");
  if (!ok) return;
  const s = body.stats || {};
  $("#stats").innerHTML =
    `<span>total <b>${s.total || 0}</b></span><span>fit <b>${s.fit || 0}</b></span>` +
    `<span>not-fit <b>${s.not_fit || 0}</b></span><span>unique <b>${s.distinct_tags || 0}</b></span>`;
  const body_ = $("#catalog-body");
  if (!body.rows.length) {
    body_.innerHTML = `<tr class="empty"><td colspan="6">No tags scanned yet.</td></tr>`;
    return;
  }
  body_.innerHTML = body.rows.map((r) => `
    <tr class="row" data-id="${r.id}">
      <td>${r.id}</td>
      <td>${esc(r.uid_hex)}</td>
      <td>${esc(r.variant || "—")}</td>
      <td><span class="tag ${r.genuine ? "yes" : "no"}">${r.genuine ? "NXP" : "NO"}</span></td>
      <td><span class="tag ${r.fit ? "fit" : "notfit"}">${r.fit ? "FIT" : "NOT FIT"}</span></td>
      <td>${esc(r.scanned_at)}</td>
    </tr>`).join("");
  body_.querySelectorAll("tr.row").forEach((tr) =>
    tr.addEventListener("click", () => openDetail(tr.dataset.id)));
}

async function openDetail(id) {
  const { ok, body } = await getJSON(`/api/scan/${id}`);
  if (!ok) return;
  $("#modal-title").textContent = `SCAN #${id} · ${body.diagnostic.uid_hex || ""}`;
  $("#modal-body").textContent = JSON.stringify(body.diagnostic, null, 2);
  $("#detail-modal").classList.remove("hidden");
}

// ---- wire up ----
$("#scan-btn").addEventListener("click", doScan);
$("#modal-close").addEventListener("click", () => $("#detail-modal").classList.add("hidden"));
$("#detail-modal").addEventListener("click", (e) => {
  if (e.target.id === "detail-modal") $("#detail-modal").classList.add("hidden");
});

refreshHealth();
refreshReaders();
refreshCatalog();
setInterval(refreshReaders, 5000);
