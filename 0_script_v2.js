(async function() {
    const forumLinks = Array.from(document.querySelectorAll('a[href*="/mod/forum/discuss.php"]'))
        .map(link => link.href)
        .filter((value, index, self) => self.indexOf(value) === index);

    const userData = {}; // Pour stocker les données des utilisateurs
    const processedPostIds = new Set(); // Pour suivre les post-id déjà traités

    for (let forumLink of forumLinks) {
        try {
            console.log('Traitement du forum:', forumLink);
            // Récupérer la page du forum
            let response = await fetch(forumLink);
            if (!response.ok) {
                console.error('Échec de la récupération du forum', forumLink);
                continue;
            }
            let text = await response.text();
            // Créer un parseur DOM
            let parser = new DOMParser();
            let doc = parser.parseFromString(text, 'text/html');

            // Extraire le titre du forum
            let forumTitleElement = doc.querySelector('h3.discussionname');
            let forumTitle = forumTitleElement ? forumTitleElement.innerText.trim() : 'Titre inconnu';

            // Extraire les commentaires et les utilisateurs depuis le document
            let commentsData = extractAllComments(doc, processedPostIds);

            // Agréger les commentaires par utilisateur
            for (let { name, comment } of commentsData) {
                if (!userData[name]) {
                    userData[name] = { total_des_commentaires: 0, forums: {} };
                }
                userData[name].total_des_commentaires += 1;

                if (!userData[name].forums[forumTitle]) {
                    userData[name].forums[forumTitle] = {
                        titre_du_forum: forumTitle,
                        nbre_de_commentaires: 0,
                        commentaires: []
                    };
                }
                userData[name].forums[forumTitle].nbre_de_commentaires += 1;
                userData[name].forums[forumTitle].commentaires.push(comment);
            }

            // Gérer la pagination
            let nextLink = getNextPageLink(doc);
            while (nextLink) {
                console.log('Récupération de la page suivante:', nextLink);
                // Récupérer la page suivante
                response = await fetch(nextLink);
                if (!response.ok) {
                    console.error('Échec de la récupération de la page suivante', nextLink);
                    break;
                }
                text = await response.text();
                doc = parser.parseFromString(text, 'text/html');

                commentsData = extractAllComments(doc, processedPostIds);

                // Agréger les commentaires par utilisateur
                for (let { name, comment } of commentsData) {
                    if (!userData[name]) {
                        userData[name] = { total_des_commentaires: 0, forums: {} };
                    }
                    userData[name].total_des_commentaires += 1;

                    if (!userData[name].forums[forumTitle]) {
                        userData[name].forums[forumTitle] = {
                            titre_du_forum: forumTitle,
                            nbre_de_commentaires: 0,
                            commentaires: []
                        };
                    }
                    userData[name].forums[forumTitle].nbre_de_commentaires += 1;
                    userData[name].forums[forumTitle].commentaires.push(comment);
                }
                nextLink = getNextPageLink(doc);
            }
        } catch (e) {
            console.error('Erreur lors du traitement du forum', forumLink, e);
        }
    }

    // Convertir userData en format JSON requis et trier les utilisateurs par ordre alphabétique
    const output = Object.keys(userData).sort((a, b) => a.localeCompare(b)).map(userName => {
        const userEntry = userData[userName];
        return {
            "utilisateur": userName,
            "total_des_commentaires": userEntry.total_des_commentaires,
            "forums": Object.values(userEntry.forums).map(forumEntry => ({
                "titre_du_forum": forumEntry.titre_du_forum,
                "nbre_de_commentaires": forumEntry.nbre_de_commentaires,
                "commentaires": forumEntry.commentaires
            }))
        };
    });

    // Sauvegarder le fichier JSON
    downloadJSON(output, 'utilisateurs.json');

    // Fonctions d'assistance
    // Fonctions d'assistance
    function extractAllComments(doc, processedPostIds) {
        const comments = [];
        const articles = doc.querySelectorAll('article.forum-post-container');

        articles.forEach(article => {
            const postId = article.getAttribute('data-post-id');
            if (processedPostIds.has(postId)) {
                // Ignorer les doublons
                return;
            }
            processedPostIds.add(postId);

            const nameElement = article.querySelector('header a[href*="/user/view.php"]');
            const name = nameElement ? nameElement.textContent.trim() : 'Inconnu';

            // --- Start Modification ---

            // 1. Get text content
            const commentElement = article.querySelector('div.post-content-container');
            let commentText = '';
            if (commentElement) {
                commentText = commentElement.innerText.trim();
            }

            // 2. Look for attachments within the article
            const attachmentLinks = article.querySelectorAll('a[href*="/pluginfile.php/"][href*="/mod_forum/attachment/"]');
            let attachmentInfo = '';

            if (attachmentLinks.length > 0) {
                attachmentLinks.forEach(link => {
                    const filename = link.textContent.trim();
                    const icon = link.querySelector('img.icon');
                    let fileType = 'Fichier joint'; // Default type

                    // Try to detect image type based on icon source URL or common extensions
                    if (icon && icon.src) {
                        const iconSrc = icon.src.toLowerCase();
                        if (iconSrc.includes('/f/image') || iconSrc.includes('/f/png') || iconSrc.includes('/f/jpg') || iconSrc.includes('/f/jpeg') || iconSrc.includes('/f/gif') || iconSrc.includes('/f/svg')) {
                            fileType = 'Image jointe';
                        }
                        // Add more checks if needed (e.g., '/f/pdf', '/f/document')
                    } else if (filename) {
                        // Fallback check using filename extension
                         const extension = filename.split('.').pop().toLowerCase();
                         const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp'];
                         if (imageExtensions.includes(extension)) {
                             fileType = 'Image jointe';
                         }
                    }

                    // Add newline if there's already attachment info or if there will be text content
                    if (attachmentInfo || commentText) {
                         attachmentInfo += '\n';
                    }
                    attachmentInfo += `[${fileType}: ${filename || 'Nom inconnu'}]`;
                });
            }

            // 3. Combine text and attachment info
            let finalComment = (commentText + attachmentInfo).trim();

            // If after everything, the comment is still empty, keep it as an empty string
            // (or you could put a placeholder like "[Message vide]")
            if (!finalComment) {
                finalComment = ''; // Or "[Message vide]";
            }

            // --- End Modification ---

            comments.push({
                name: name,
                comment: finalComment // Use the combined final comment
            });
        });

        return comments;
    }

    function getNextPageLink(doc) {
        // Trouver les liens de pagination pour la page suivante
        const nextLinkElement = doc.querySelector('a[rel="next"], a[aria-label*="Next"], a[aria-label*="Suivant"], a[title*="Next"], a[title*="Suivant"]');
        if (nextLinkElement) {
            return nextLinkElement.href;
        }
        return null;
    }

    function downloadJSON(obj, filename) {
        const dataStr = JSON.stringify(obj, null, 4);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'utilisateurs.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
})();
