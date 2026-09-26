// status.lazynext.com → https://lazynext.com/status (canonical status page).
// The marketing worker is assets-only and can't host-redirect, so this tiny
// worker owns the hostname and 301s everything to the real page.
export default {
  fetch() {
    return Response.redirect("https://lazynext.com/status", 301);
  },
};
