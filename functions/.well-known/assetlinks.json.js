// Serves https://avnideepayurveda.in/.well-known/assetlinks.json
//
// Cloudflare Pages never uploads files/directories whose name starts with a dot,
// so a static .well-known/assetlinks.json would 404 and the Android app would keep
// showing the Chrome URL bar. A Pages Function is the supported workaround.
import { buildAssetLinks, PACKAGE_NAME } from "../_lib/assetlinks.js";

export async function onRequestGet() {
  const statements = buildAssetLinks();

  if (!statements) {
    return new Response(
      JSON.stringify({
        error: "assetlinks_not_configured",
        package_name: PACKAGE_NAME,
        hint: "Run: node scripts/set-assetlinks.mjs <SHA-256 fingerprint>",
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Assetlinks-Status": "unconfigured",
        },
      }
    );
  }

  return new Response(JSON.stringify(statements, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Short TTL: a fresh fingerprint must go live within minutes, not days.
      "Cache-Control": "public, max-age=300, must-revalidate",
      "X-Assetlinks-Status": "ok",
    },
  });
}
