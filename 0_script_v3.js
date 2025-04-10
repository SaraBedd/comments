(async function() {
    // 1. Get unique forum discussion links from the current page
    const forumLinks = Array.from(document.querySelectorAll('a[href*="/mod/forum/discuss.php"]'))
        .map(link => link.href)
        .filter((value, index, self) => self.indexOf(value) === index); // Keep only unique links

    const userData = {}; // Object to store aggregated data for each user
    const processedPostIds = new Set(); // Set to track post IDs already processed to avoid duplicates across pages/fetches

    // 2. Loop through each unique forum discussion link
    for (let forumLink of forumLinks) {
        try {
            console.log('Processing forum:', forumLink);
            // Fetch the first page of the forum discussion
            let response = await fetch(forumLink);
            if (!response.ok) {
                console.error('Failed to fetch forum:', forumLink, response.status);
                continue; // Skip this forum if fetch fails
            }
            let text = await response.text();
            // Create a DOM parser to process the fetched HTML
            let parser = new DOMParser();
            let doc = parser.parseFromString(text, 'text/html');

            // Extract the forum discussion title
            let forumTitleElement = doc.querySelector('h3.discussionname');
            let forumTitle = forumTitleElement ? forumTitleElement.innerText.trim() : 'Unknown Title';

            // --- Process the first page ---
            // Extract comments, user names, and group labels from the current document
            let commentsData = extractAllComments(doc, processedPostIds); // Function defined below

            // Aggregate comments and group label by user
            for (let { name, comment, groupLabel } of commentsData) { // Destructure the returned object
                // Initialize user data if this user is seen for the first time
                if (!userData[name]) {
                    userData[name] = { total_des_commentaires: 0, groupLabel: null, forums: {} };
                }
                // Store the group label only if it hasn't been set yet for this user
                if (userData[name].groupLabel === null && groupLabel) {
                    userData[name].groupLabel = groupLabel;
                }

                // Increment total comment count for the user
                userData[name].total_des_commentaires += 1;

                // Initialize data for this specific forum for this user if needed
                if (!userData[name].forums[forumTitle]) {
                    userData[name].forums[forumTitle] = {
                        titre_du_forum: forumTitle,
                        nbre_de_commentaires: 0,
                        commentaires: []
                    };
                }
                // Increment comment count for this forum and add the comment
                userData[name].forums[forumTitle].nbre_de_commentaires += 1;
                userData[name].forums[forumTitle].commentaires.push(comment);
            }
            // --- End processing first page ---

            // --- Handle Pagination ---
            let nextLink = getNextPageLink(doc); // Function defined below
            while (nextLink) {
                console.log('Fetching next page:', nextLink);
                // Fetch the next page
                response = await fetch(nextLink);
                if (!response.ok) {
                    console.error('Failed to fetch next page:', nextLink, response.status);
                    break; // Stop pagination for this forum if a page fails
                }
                text = await response.text();
                doc = parser.parseFromString(text, 'text/html');

                // Extract comments from the new page's document
                commentsData = extractAllComments(doc, processedPostIds);

                // Aggregate comments and group label from the next page (same logic as above)
                for (let { name, comment, groupLabel } of commentsData) {
                    if (!userData[name]) {
                        userData[name] = { total_des_commentaires: 0, groupLabel: null, forums: {} };
                    }
                    if (userData[name].groupLabel === null && groupLabel) {
                        userData[name].groupLabel = groupLabel;
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

                // Check for the next page link on the *current* document
                nextLink = getNextPageLink(doc);
            }
            // --- End Pagination Handling ---

        } catch (e) {
            console.error('Error processing forum', forumLink, e);
        }
    } // End loop through forum links

    // 3. Format the aggregated data for JSON output
    const output = Object.keys(userData)
        .sort((a, b) => a.localeCompare(b)) // Sort users alphabetically by name
        .map(userName => {
            const userEntry = userData[userName];
            return {
                "utilisateur": userName,
                "groupe": userEntry.groupLabel || 'Inconnu', // Add the group label, default to 'Inconnu'
                "total_des_commentaires": userEntry.total_des_commentaires,
                // Map the forums object to an array as required
                "forums": Object.values(userEntry.forums).map(forumEntry => ({
                    "titre_du_forum": forumEntry.titre_du_forum,
                    "nbre_de_commentaires": forumEntry.nbre_de_commentaires,
                    "commentaires": forumEntry.commentaires
                }))
            };
        });

    // 4. Trigger JSON file download
    downloadJSON(output, 'utilisateurs_forums.json'); // Function defined below
    console.log('Processing complete. Check downloads for utilisateurs_forums.json');

    // --- Helper Functions ---

    /**
     * Extracts user names, comments (including attachment info), and group labels from forum post articles in a document.
     * @param {Document} doc - The HTML document object to parse.
     * @param {Set<string>} processedPostIds - A set of post IDs that have already been processed.
     * @returns {Array<{name: string, comment: string, groupLabel: string|null}>} An array of objects containing comment data.
     */
    function extractAllComments(doc, processedPostIds) {
        const comments = [];
        // Select all article elements representing forum posts
        const articles = doc.querySelectorAll('article.forum-post-container');

        articles.forEach(article => {
            // Get the unique post ID
            const postId = article.getAttribute('data-post-id');
            // Skip if this post has already been processed (prevents duplicates from pagination overlap/errors)
            if (!postId || processedPostIds.has(postId)) {
                return;
            }
            processedPostIds.add(postId); // Mark this post ID as processed

            // Extract user name
            const nameElement = article.querySelector('header a[href*="/user/view.php"]');
            const name = nameElement ? nameElement.textContent.trim() : 'Inconnu';

            // Extract text content from the main comment container
            const commentElement = article.querySelector('div.post-content-container');
            let commentText = commentElement ? commentElement.innerText.trim() : '';

            // Look for attachment links within the article
            const attachmentLinks = article.querySelectorAll('a[href*="/pluginfile.php/"][href*="/mod_forum/attachment/"]');
            let attachmentInfo = '';

            if (attachmentLinks.length > 0) {
                attachmentLinks.forEach(link => {
                    const filename = link.textContent.trim();
                    const icon = link.querySelector('img.icon');
                    let fileType = 'Fichier joint'; // Default type

                    // Try to detect image type based on icon source URL or filename extension
                    if (icon && icon.src) {
                        const iconSrc = icon.src.toLowerCase();
                        // Check icon source for common Moodle image indicators
                        if (iconSrc.includes('/f/image') || iconSrc.includes('/f/png') || iconSrc.includes('/f/jpg') || iconSrc.includes('/f/jpeg') || iconSrc.includes('/f/gif') || iconSrc.includes('/f/svg')) {
                            fileType = 'Image jointe';
                        }
                        // Add more specific checks if needed (e.g., '/f/pdf', '/f/document')
                    } else if (filename) {
                        // Fallback check using filename extension if icon check failed or icon missing
                         const extension = filename.split('.').pop().toLowerCase();
                         const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp'];
                         if (imageExtensions.includes(extension)) {
                             fileType = 'Image jointe';
                         }
                    }

                    // Add newline before attachment info if there's already other attachment info or text content
                    if (attachmentInfo || commentText) {
                         attachmentInfo += '\n';
                    }
                    // Format the attachment information string
                    attachmentInfo += `[${fileType}: ${filename || 'Nom inconnu'}]`;
                });
            }

            // Combine the extracted text and attachment information
            let finalComment = (commentText + attachmentInfo).trim();
            // Ensure truly empty posts result in an empty string, not just whitespace
            if (!finalComment) {
                finalComment = ''; // Or use a placeholder like "[Message vide]"
            }

            // Extract group label ('otter' or 'flamingo')
            let groupLabel = null; // Default to null if no relevant group found
            // Find the image element representing the user's group
            const groupImageElement = article.querySelector('div.author-groups-container img');
            if (groupImageElement) {
                // Get the identifier text from alt or title attribute
                const groupIdentifier = (groupImageElement.getAttribute('alt') || groupImageElement.getAttribute('title') || '').trim();
                // Assign label based on the identifier
                if (groupIdentifier.includes('IND8108_02C')) {
                    groupLabel = 'otter';
                } else if (groupIdentifier.includes('IND8108_01C')) {
                    groupLabel = 'flamingo';
                }
                // Add more 'else if' conditions here for other groups if needed
            }

            // Push the extracted data for this comment
            comments.push({
                name: name,
                comment: finalComment,
                groupLabel: groupLabel // Include the determined group label
            });
        });

        return comments;
    }

    /**
     * Finds the URL of the next pagination link in the document.
     * @param {Document} doc - The HTML document object to search within.
     * @returns {string | null} The URL of the next page, or null if not found.
     */
    function getNextPageLink(doc) {
        // Look for common selectors for the "next page" link
        const nextLinkElement = doc.querySelector('a[rel="next"], a[aria-label*="Next"], a[aria-label*="Suivant"], a[title*="Next"], a[title*="Suivant"]');
        // Return the href attribute if the element exists, otherwise null
        return nextLinkElement ? nextLinkElement.href : null;
    }

    /**
     * Triggers the download of a JavaScript object as a JSON file.
     * @param {object} obj - The JavaScript object to download.
     * @param {string} filename - The desired name for the downloaded file.
     */
    function downloadJSON(obj, filename) {
        // Convert the object to a formatted JSON string
        const dataStr = JSON.stringify(obj, null, 4); // Use 4 spaces for indentation
        // Create a Blob object with the JSON data
        const blob = new Blob([dataStr], { type: 'application/json' });
        // Create a temporary URL for the Blob
        const url = URL.createObjectURL(blob);
        // Create a temporary anchor element
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'data.json'; // Set the download filename
        // Append the anchor to the body, click it, and then remove it
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke the temporary URL to free up resources
        URL.revokeObjectURL(url);
    }

})(); // Immediately Invoked Function Expression (IIFE)