// launchdeck.lazynext.com → https://lazynext.com (product retired).
// Same shape as ops/status-redirect: this tiny worker owns the hostname so the
// stale proxied DNS record stops fast-failing 522, and 301s to the real site.
export default {
  fetch() {
    return Response.redirect("https://lazynext.com", 301);
  },
};
