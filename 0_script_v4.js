(async function() {
    // Figure out the forum view URL. If you're ON a forum page, use it.
    // Otherwise, collect forum links from current page.
    const forumViewLinks = Array.from(document.querySelectorAll('a[href*="/mod/forum/view.php?id="]'))
        .map(a => a.href.split('#')[0])
        .filter((v, i, s) => s.indexOf(v) === i);

    // If we're already on a forum view page, just use this one
    const currentUrl = window.location.href;
    const forumsToProcess = currentUrl.includes('/mod/forum/view.php?id=')
        ? [currentUrl.split('#')[0]]
        : forumViewLinks;

    console.log('Forums to process:', forumsToProcess);

    const userData = {};
    const processedPostIds = new Set();
    const parser = new DOMParser();

    // Helper: normalize names (strip NBSP, collapse whitespace)
    const normName = s => (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

    // Step 1: For each forum, collect ALL discussion links across ALL pages of the forum view
    async function collectAllDiscussionLinks(forumViewUrl) {
        const discussionLinks = new Set();
        let pageUrl = forumViewUrl;
        let safety = 0;

        while (pageUrl && safety++ < 50) {
            console.log('Scanning forum page:', pageUrl);
            const resp = await fetch(pageUrl);
            if (!resp.ok) break;
            const doc = parser.parseFromString(await resp.text(), 'text/html');

            // Grab every discussion link on this page of the forum view
            doc.querySelectorAll('a[href*="/mod/forum/discuss.php?d="]').forEach(a => {
                // Normalize: strip #anchors and &parent= etc, keep just d=ID
                const m = a.href.match(/discuss\.php\?d=(\d+)/);
                if (m) discussionLinks.add(`https://moodle.polymtl.ca/mod/forum/discuss.php?d=${m[1]}`);
            });

            // Find pagination on the forum view page
            const next = doc.querySelector('.pagination a[rel="next"], nav[aria-label*="agin"] a[rel="next"], a[aria-label*="Suivant"], a[aria-label*="Next"]');
            pageUrl = next ? next.href : null;
        }
        return Array.from(discussionLinks);
    }

    // Step 2: extract posts from a discussion page
    function extractPosts(doc) {
        const out = [];
        doc.querySelectorAll('article.forum-post-container').forEach(article => {
            const postId = article.getAttribute('data-post-id');
            if (!postId || processedPostIds.has(postId)) return;
            processedPostIds.add(postId);

            const nameEl = article.querySelector('header a[href*="/user/view.php"]');
            const name = normName(nameEl ? nameEl.textContent : 'Inconnu');

            const contentEl = article.querySelector('div.post-content-container');
            let text = contentEl ? contentEl.innerText.trim() : '';

            // Attachments
            const attachments = [];
            article.querySelectorAll('a[href*="/pluginfile.php/"][href*="/mod_forum/"]').forEach(link => {
                const fn = link.textContent.trim();
                if (fn) attachments.push(`[Fichier: ${fn}]`);
            });
            if (attachments.length) text = (text + '\n' + attachments.join('\n')).trim();

            // Group detection — check BOTH alt and title, and look at all group images
            let groupLabel = null;
            article.querySelectorAll('div.author-groups-container img, .author-groups-container img').forEach(img => {
                const id = ((img.getAttribute('alt') || '') + ' ' + (img.getAttribute('title') || '')).trim();
                if (/IND8108_02C/i.test(id)) groupLabel = 'otter';
                else if (/IND8108_01C/i.test(id)) groupLabel = 'flamingo';
            });

            out.push({ name, comment: text, groupLabel });
        });
        return out;
    }

    // Step 3: process a discussion (with pagination of replies)
    async function processDiscussion(discussionUrl) {
        let url = discussionUrl;
        let title = 'Unknown Title';
        let safety = 0;
        const posts = [];

        while (url && safety++ < 20) {
            const resp = await fetch(url);
            if (!resp.ok) { console.warn('Failed:', url); break; }
            const doc = parser.parseFromString(await resp.text(), 'text/html');

            // Title: try discussionname first, then the h3 inside the first article
            if (title === 'Unknown Title') {
                const t = doc.querySelector('h3.discussionname, article.forum-post-container h3');
                if (t) title = normName(t.textContent);
            }

            posts.push(...extractPosts(doc));

            const next = doc.querySelector('a[rel="next"], a[aria-label*="Suivant"], a[aria-label*="Next"]');
            url = next ? next.href : null;
        }
        return { title, posts };
    }

    // MAIN
    for (const forumUrl of forumsToProcess) {
        try {
            const discussionLinks = await collectAllDiscussionLinks(forumUrl);
            console.log(`Found ${discussionLinks.length} discussions in ${forumUrl}`);

            for (const dUrl of discussionLinks) {
                try {
                    const { title, posts } = await processDiscussion(dUrl);
                    for (const { name, comment, groupLabel } of posts) {
                        if (!name || name === 'Inconnu') continue;
                        if (!userData[name]) userData[name] = { total_des_commentaires: 0, groupLabel: null, forums: {} };
                        if (!userData[name].groupLabel && groupLabel) userData[name].groupLabel = groupLabel;
                        userData[name].total_des_commentaires++;
                        if (!userData[name].forums[title]) {
                            userData[name].forums[title] = { titre_du_forum: title, nbre_de_commentaires: 0, commentaires: [] };
                        }
                        userData[name].forums[title].nbre_de_commentaires++;
                        userData[name].forums[title].commentaires.push(comment);
                    }
                } catch (e) { console.error('Error in discussion', dUrl, e); }
            }
        } catch (e) { console.error('Error in forum', forumUrl, e); }
    }

    const output = Object.keys(userData).sort((a, b) => a.localeCompare(b)).map(u => ({
        utilisateur: u,
        groupe: userData[u].groupLabel || 'Inconnu',
        total_des_commentaires: userData[u].total_des_commentaires,
        forums: Object.values(userData[u].forums)
    }));

    console.log(`Total unique users: ${output.length}`);
    console.log(`Total posts counted: ${processedPostIds.size}`);

    // Download
    const blob = new Blob([JSON.stringify(output, null, 4)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'utilisateurs_forums.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    console.log('Done. Downloaded utilisateurs_forums.json');
})();