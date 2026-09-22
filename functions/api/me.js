/* Answers "who is signed in?" so the profile page and the top bar can show the right thing.
   The gate file has already worked this out, so there is nothing to check again here. */

export function onRequestGet({ data, env }) {
  const body = {
    signedIn: !!(data && data.user),
    user: (data && data.user) || null,
    ready: !!env.DB
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
