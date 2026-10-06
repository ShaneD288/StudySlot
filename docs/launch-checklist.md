# Launch checklist

1. ~~**Fill in the operator's name**~~ Done: Shane Dillon, in `public/privacy.html` and `public/terms.html`. `scripts/check-launch.js` still blocks a deploy if a `[Your name]` placeholder comes back.
2. **Set the `SHARE_KEY` Worker secret** (`npx wrangler secret put SHARE_KEY`, 32+ random characters). Without it, calendar-feed and friend links can't be created.
3. **Add the GitHub secrets** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` so the deploy workflow can run, and protect `main` (pull requests and passing CI required).
4. **Register the domain** `studyslot.ie` (about €10–20 a year; .ie needs a connection to Ireland), add it to Cloudflare, and uncomment the `routes` line in `wrangler.jsonc`.
5. **Set up email** for `hello@studyslot.ie` with Cloudflare Email Routing (free; forwards to a private inbox).
6. **Check the name** on the EU trademark register ([TMview](https://www.tmdn.org/tmview)) for "Studyslot". An EU trademark costs from €850; an Irish one starts lower.
7. **Have the legal pages reviewed** before sharing widely.
8. **Test on real phones:** at least one iPhone (Safari) and one Android (Chrome): install, offline mode, calendar feed subscription, adding a friend by QR code.
9. **After the first deploy:** in the Cloudflare dashboard, check that Wrangler created the `LINK_RESETS` KV namespace. Then, on the live site, share a friend link, tap **Reset my link**, and check the old link says it was reset (allow a minute) while your calendar subscription keeps working.
10. **Check link previews:** paste the live address and a friend link into WhatsApp and iMessage. Both should show the Studyslot image; the friend link should say "A friend shared their timetable".
11. **Tag the release:** `git tag -a v1.0.0 -m "Studyslot 1.0.0"` and update `CHANGELOG.md` with the date.
