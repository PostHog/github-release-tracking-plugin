async function setupPlugin({ config, global }) {
    global.posthogHost = config.posthogHost.includes('http') ? config.posthogHost : 'https://' + config.posthogHost

    global.posthogOptions = {
        headers: {
            Authorization: `Bearer ${config.posthogApiKey}`
        }
    }

    const ghBasicAuthToken = Buffer.from(`${config.ghOwner}:${config.ghToken}`).toString('base64')

    global.ghOptions = config.ghToken
        ? {
              headers: {
                  Authorization: `Basic ${ghBasicAuthToken}`
              }
          }
        : {}

    try {
        const posthogRes = await fetchWithRetry(`${global.posthogHost}/api/user`, global.posthogOptions)

        const githubRes = await fetchWithRetry(
            `https://api.github.com/repos/${config.ghOwner}/${config.ghRepo}`,
            global.ghOptions
        )

        if (posthogRes.status !== 200) {
            throw new Error('Invalid PostHog Personal API key')
        }
        if (githubRes.status !== 200) {
            throw new Error('Invalid GitHub repo owner or name')
        }
    } catch {
        throw new Error('Invalid PostHog Personal API key or GitHub Personal Token')
    }
}

async function runEveryDay({ config, global }) {
    const annotationsResponse = await fetchWithRetry(
        `${global.posthogHost}/api/annotation/?scope=organization&deleted=false`,
        global.posthogOptions
    )

    const annotationsJson = await annotationsResponse.json()
    let annotations = new Set(annotationsJson.results.map((annotation) => annotation.content))

    const ghTagsResponse = await fetchWithRetry(
        `https://api.github.com/repos/${config.ghOwner}/${config.ghRepo}/git/refs/tags`,
        global.ghOptions
    )
    const ghTagsJson = await ghTagsResponse.json()

    const newTags = ghTagsJson
        .map((tag) => ({
            name: tag.ref.split('refs/tags/')[1],
            url: tag.object.url
        }))
        .filter((tag) => !annotations.has(tag.name))

    for (let tag of newTags) {
        const tagDetailsResponse = await fetchWithRetry(tag.url, global.ghOptions)
        const tagDetailsJson = await tagDetailsResponse.json()

        const createAnnotationRes = await fetchWithRetry(
            `${global.posthogHost}/api/annotation/`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.posthogApiKey}`
                },
                body: JSON.stringify({
                    content: tag.name,
                    scope: 'organization',
                    date_marker: getTagDate(tagDetailsJson)
                })
            },
            'POST'
        )

        if (createAnnotationRes.status === 201) {
            posthog.capture('created_tag_annotation', { tag: tag.name })
        }
    }
}

async function fetchWithRetry(url, options = {}, method = 'GET', isRetry = false) {
    try {
        const res = await fetch(url, { method: method, ...options })
        return res
    } catch {
        if (isRetry) {
            throw new Error(`${method} request to ${url} failed.`)
        }
        const res = await fetchWithRetry(url, options, (method = method), (isRetry = true))
        return res
    }
}

function getTagDate(tag) {
    return tag.committer ? tag.committer.date : tag.tagger ? tag.tagger.date : tag.author ? tag.author.date : null
}
