// steam-explore: admin API Explorer proxy (issue #186).
//
// The stores' public endpoints are not CORS-enabled, so the admin panel cannot
// call them from the browser. This function fetches a whitelisted endpoint
// server-side and returns the raw JSON, for manual debugging of Steam / GOG /
// Epic game data. Read-only, whitelisted. verify_jwt=false -- it exposes
// nothing beyond the public store responses.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EPIC_SEARCH_QUERY = `query searchStoreQuery($keywords: String!, $country: String!, $locale: String!) {
  Catalog {
    searchStore(keywords: $keywords, country: $country, locale: $locale, count: 20) {
      elements { title id namespace productSlug urlSlug offerType releaseDate
        keyImages { type url } categories { path } price(country: $country) { totalPrice { discountPrice originalPrice } } }
    }
  }
}`;

type EndpointDef = {
  // Whether the endpoint takes a numeric id or a free-text term.
  arg: "id" | "term" | "none";
  method: "GET" | "POST";
  url: (arg: string) => string;
  headers?: Record<string, string>;
  body?: (arg: string) => string;
};

// key = "<store>_<endpoint>". Keep in sync with the admin component.
const ENDPOINTS: Record<string, EndpointDef> = {
  steam_appdetails: {
    arg: "id",
    method: "GET",
    url: (id) => `https://store.steampowered.com/api/appdetails?appids=${id}`,
  },
  steam_deck: {
    arg: "id",
    method: "GET",
    url: (id) => `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${id}`,
  },
  steam_store_redirect: {
    // Fetches the storefront page with redirects followed. Useful when
    // appdetails returns success:false: if the app was replaced by a
    // newer appid (e.g. 5488 -> 45700 for Devil May Cry 4), the final URL
    // encodes the new appid in its /app/<newId>/ path. Response.data is
    // { original_url, final_url, replaced_by }. #199
    arg: "id",
    method: "GET",
    url: (id) => `https://store.steampowered.com/app/${id}/`,
  },
  // Common public Steam endpoints -- no API key required. Rate-limited by
  // Steam but shared across the whole edge function. Documented at
  // https://steamapi.xpaw.me and https://partner.steamgames.com/doc/webapi
  steam_current_players: {
    arg: "id",
    method: "GET",
    url: (id) => `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${id}`,
  },
  steam_global_achievements: {
    arg: "id",
    method: "GET",
    url: (id) => `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`,
  },
  steam_news: {
    arg: "id",
    method: "GET",
    url: (id) => `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${id}&count=5&maxlength=300&format=json`,
  },
  steam_reviews: {
    arg: "id",
    method: "GET",
    url: (id) => `https://store.steampowered.com/appreviews/${id}?json=1&language=all&purchase_type=all&filter=summary`,
  },
  steam_community_search: {
    arg: "term",
    method: "GET",
    url: (t) => `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(t)}`,
  },
  steam_featured: {
    // No arg: dumps the currently-featured storefront blocks. Useful for
    // sanity-checking storefront availability and for spotting deals.
    arg: "none",
    method: "GET",
    url: () => `https://store.steampowered.com/api/featured?cc=us&l=en`,
  },
  steam_featured_categories: {
    arg: "none",
    method: "GET",
    url: () => `https://store.steampowered.com/api/featuredcategories?cc=us&l=en`,
  },
  gog_product: {
    arg: "id",
    method: "GET",
    url: (id) => `https://api.gog.com/products/${id}?expand=description,screenshots,videos,rating`,
  },
  gog_search: {
    arg: "term",
    method: "GET",
    url: (t) =>
      `https://catalog.gog.com/v1/catalog?query=${encodeURIComponent(t)}&limit=20&locale=en-US&currencyCode=USD&countryCode=US`,
  },
  epic_search: {
    arg: "term",
    method: "POST",
    url: () => "https://store.epicgames.com/graphql",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://store.epicgames.com",
      Referer: "https://store.epicgames.com/en-US/browse",
    },
    body: (t) =>
      JSON.stringify({
        query: EPIC_SEARCH_QUERY,
        variables: { keywords: t, country: "US", locale: "en-US" },
      }),
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "POST only" }, { status: 405, headers: corsHeaders });
  }

  let body: { endpoint?: string; app_id?: string; id?: string; term?: string } | null = null;
  try { body = await req.json(); } catch { /* fall through */ }
  const endpoint = String(body?.endpoint ?? "").trim();
  // app_id kept for backward compatibility with the original steam-only client.
  const id = String(body?.id ?? body?.app_id ?? "").trim();
  const term = String(body?.term ?? "").trim();

  const def = ENDPOINTS[endpoint];
  if (!def) {
    return Response.json(
      { ok: false, error: `unknown endpoint "${endpoint}" (allowed: ${Object.keys(ENDPOINTS).join(", ")})` },
      { status: 400, headers: corsHeaders },
    );
  }

  let arg: string;
  if (def.arg === "none") {
    // Argless endpoints (featured / featuredcategories). We still pass an
    // empty string to url() so the signature stays uniform.
    arg = "";
  } else if (def.arg === "id") {
    if (!/^\d+$/.test(id)) {
      return Response.json({ ok: false, error: "id must be numeric for this endpoint" }, { status: 400, headers: corsHeaders });
    }
    arg = id;
  } else {
    if (!term) {
      return Response.json({ ok: false, error: "term is required for this endpoint" }, { status: 400, headers: corsHeaders });
    }
    arg = term;
  }

  const url = def.url(arg);
  try {
    const init: RequestInit = { method: def.method, headers: def.headers ?? { Accept: "application/json" } };
    if (def.method === "POST" && def.body) init.body = def.body(arg);
    const upstream = await fetch(url, init);
    // steam_store_redirect: we don't care about the body, only the final URL
    // path. Parse out the new appid if Steam redirected to /app/<newId>/,
    // else return the same appid so admins see it's a live URL. #199
    if (endpoint === "steam_store_redirect") {
      const finalUrl = upstream.url || url;
      const match = /\/app\/(\d+)(?:\/|$)/.exec(finalUrl);
      const finalAppId = match ? match[1] : null;
      const replacedBy = finalAppId && finalAppId !== arg ? finalAppId : null;
      console.log(`[steam-explore] endpoint=${endpoint} arg=${arg} final=${finalUrl} replaced_by=${replacedBy}`);
      return Response.json(
        {
          ok: upstream.ok,
          endpoint,
          arg,
          url,
          status: upstream.status,
          data: {
            original_appid: arg,
            original_url: url,
            final_url: finalUrl,
            final_appid: finalAppId,
            replaced_by: replacedBy,
            note: replacedBy
              ? `Steam redirected appid ${arg} to appid ${replacedBy}. This app has been superseded by a newer entry.`
              : finalAppId === arg
                ? "Store page resolved back to the same appid: this app is live."
                : "Store page redirected to a non-app URL (delisted, homepage, or region-blocked).",
          },
        },
        { status: 200, headers: corsHeaders },
      );
    }
    const text = await upstream.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    console.log(`[steam-explore] endpoint=${endpoint} arg=${arg} status=${upstream.status}`);
    return Response.json(
      { ok: upstream.ok, endpoint, arg, url, status: upstream.status, data },
      { status: 200, headers: corsHeaders },
    );
  } catch (e) {
    return Response.json(
      { ok: false, endpoint, arg, url, error: `fetch failed: ${(e as Error).message}` },
      { status: 200, headers: corsHeaders },
    );
  }
});
