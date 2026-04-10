(async function() {
    const parser = new DOMParser();
    const normName = s => (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

    // Determine forums to process
    const currentUrl = window.location.href.split('#')[0];
    let forumsToProcess;
    if (currentUrl.includes('/mod/forum/view.php?id=')) {
        forumsToProcess = [currentUrl];
    } else {
        forumsToProcess = Array.from(document.querySelectorAll('a[href*="/mod/forum/view.php?id="]'))
            .map(a => a.href.split('#')[0])
            .filter((v, i, s) => s.indexOf(v) === i);
    }
    console.log('Forums à traiter :', forumsToProcess);

    const userData = {};
    const processedPostIds = new Set();

    // Collect discussions AND their titles from the forum view page (paginated)
    async function collectDiscussions(forumViewUrl) {
        const discussions = new Map(); // id -> { url, title }
        let pageUrl = forumViewUrl;
        let safety = 0;

        while (pageUrl && safety++ < 50) {
            console.log('Page du forum :', pageUrl);
            const resp = await fetch(pageUrl);
            if (!resp.ok) { console.warn('Échec :', pageUrl); break; }
            const doc = parser.parseFromString(await resp.text(), 'text/html');

            // Each discussion row has a link with the title in textContent and title attribute
            doc.querySelectorAll('tr.discussion a[href*="/mod/forum/discuss.php?d="]').forEach(a => {
                const m = a.href.match(/discuss\.php\?d=(\d+)/);
                if (!m) return;
                const id = m[1];
                const titleText = normName(a.getAttribute('title') || a.textContent);
                // Skip empty titles (e.g. author avatars linking to the discussion)
                if (!titleText) return;
                // First occurrence wins; the topic cell comes before the "last post" cell
                if (!discussions.has(id)) {
                    discussions.set(id, {
                        url: `https://moodle.polymtl.ca/mod/forum/discuss.php?d=${id}`,
                        title: titleText
                    });
                }
            });

            // Fallback: if selector above found nothing, grab any discuss.php link
            if (discussions.size === 0) {
                doc.querySelectorAll('a[href*="/mod/forum/discuss.php?d="]').forEach(a => {
                    const m = a.href.match(/discuss\.php\?d=(\d+)/);
                    if (!m) return;
                    const id = m[1];
                    const titleText = normName(a.getAttribute('title') || a.textContent);
                    if (!titleText || discussions.has(id)) return;
                    discussions.set(id, {
                        url: `https://moodle.polymtl.ca/mod/forum/discuss.php?d=${id}`,
                        title: titleText
                    });
                });
            }

            const next = doc.querySelector('.pagination a[rel="next"], nav a[rel="next"], a[aria-label*="Suivant"], a[aria-label*="Next"]');
            pageUrl = next ? next.href : null;
        }
        return Array.from(discussions.values());
    }

    // Extract posts from a discussion page
    function extractPosts(doc) {
        const out = [];
        doc.querySelectorAll('article.forum-post-container').forEach(article => {
            const postId = article.getAttribute('data-post-id');
            if (!postId || processedPostIds.has(postId)) return;
            processedPostIds.add(postId);

            const nameEl = article.querySelector('header a[href*="/user/view.php"]');
            const name = normName(nameEl ? nameEl.textContent : '');
            if (!name) return;

            const contentEl = article.querySelector('div.post-content-container');
            let text = contentEl ? contentEl.innerText.trim() : '';

            // Attachments
            const attachments = [];
            article.querySelectorAll('a[href*="/pluginfile.php/"][href*="/mod_forum/"]').forEach(link => {
                const fn = normName(link.textContent);
                if (fn) attachments.push(`[Fichier joint : ${fn}]`);
            });
            if (attachments.length) text = (text + '\n' + attachments.join('\n')).trim();

            // Group detection — French labels
            let groupLabel = null;
            article.querySelectorAll('.author-groups-container img').forEach(img => {
                const id = ((img.getAttribute('alt') || '') + ' ' + (img.getAttribute('title') || '')).trim();
                if (/IND8108_02C/i.test(id)) groupLabel = 'Loutre';
                else if (/IND8108_01C/i.test(id)) groupLabel = 'Flamant rose';
            });

            out.push({ name, comment: text, groupLabel });
        });
        return out;
    }

    // Process a discussion across all its pages
    async function processDiscussion(discussionUrl) {
        let url = discussionUrl;
        let safety = 0;
        const posts = [];

        while (url && safety++ < 20) {
            const resp = await fetch(url);
            if (!resp.ok) { console.warn('Échec discussion :', url); break; }
            const doc = parser.parseFromString(await resp.text(), 'text/html');
            posts.push(...extractPosts(doc));
            const next = doc.querySelector('a[rel="next"], a[aria-label*="Suivant"], a[aria-label*="Next"]');
            url = next ? next.href : null;
        }
        return posts;
    }

    // Main loop
    for (const forumUrl of forumsToProcess) {
        try {
            const discussions = await collectDiscussions(forumUrl);
            console.log(`${discussions.length} discussions trouvées dans ${forumUrl}`);

            for (const { url, title } of discussions) {
                try {
                    const posts = await processDiscussion(url);
                    for (const { name, comment, groupLabel } of posts) {
                        if (!userData[name]) {
                            userData[name] = { total_des_commentaires: 0, groupLabel: null, forums: {} };
                        }
                        if (!userData[name].groupLabel && groupLabel) {
                            userData[name].groupLabel = groupLabel;
                        }
                        userData[name].total_des_commentaires++;
                        if (!userData[name].forums[title]) {
                            userData[name].forums[title] = {
                                titre_du_forum: title,
                                nbre_de_commentaires: 0,
                                commentaires: []
                            };
                        }
                        userData[name].forums[title].nbre_de_commentaires++;
                        userData[name].forums[title].commentaires.push(comment);
                    }
                } catch (e) { console.error('Erreur discussion', url, e); }
            }
        } catch (e) { console.error('Erreur forum', forumUrl, e); }
    }

    // Second pass: propagate group labels across all entries for the same user
    // (in case a user's group only appeared in some posts)
    for (const name of Object.keys(userData)) {
        if (!userData[name].groupLabel) userData[name].groupLabel = 'Inconnu';
    }

    const output = Object.keys(userData)
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .map(u => ({
            utilisateur: u,
            groupe: userData[u].groupLabel,
            total_des_commentaires: userData[u].total_des_commentaires,
            forums: Object.values(userData[u].forums)
                .sort((a, b) => a.titre_du_forum.localeCompare(b.titre_du_forum, 'fr'))
        }));

    console.log(`Utilisateurs uniques : ${output.length}`);
    console.log(`Messages comptés : ${processedPostIds.size}`);

    const blob = new Blob([JSON.stringify(output, null, 4)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'utilisateurs_forums.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    console.log('Terminé. Fichier téléchargé : utilisateurs_forums.json');
})();