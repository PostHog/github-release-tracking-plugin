class KnownError extends Error {}

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
        const posthogRes = await posthog.api.get(`/api/users/@me`, { host: global.posthogHost })

        const githubRes = await fetchWithRetry(
            `https://api.github.com/repos/${config.ghOwner}/${config.ghRepo}`,
            global.ghOptions
        )

        if (posthogRes.status !== 200) {
            const resJson = await posthogRes.json()
            throw new KnownError(`Invalid PostHog Personal API key or host. Response: ${JSON.stringify(resJson)}`)
        }
        if (githubRes.status !== 200) {
            const resJson = await githubRes.json()
            throw new KnownError(`Invalid GitHub repo owner, name, or token, permissions. Error: ${JSON.stringify(resJson)}`)
        }
    } catch (e) {
        if (e instanceof KnownError) {
            throw(e)
        }
        throw new Error('Unknown error when trying to connect to GitHub and PostHog.')
    }
}

async function runEveryMinute({ config, global, cache }) {
    const lastRun = await cache.get('lastRun')
    if (
        lastRun &&
        new Date().getTime() - Number(lastRun) < 3600000 // 60*60*1000ms = 1 hour
    ) {
        return
    }
    let allPostHogAnnotations = []
    let next = `${global.posthogHost}/api/annotation/?scope=organization&deleted=false`
    while (next) {
        const nextPath = next.replace(global.posthogHost, '')
        const annotationsResponse = await posthog.api.get(nextPath, { host: global.posthogHost })
        const annotationsJson = await annotationsResponse.json()
        const annotationNames = annotationsJson.results.map((annotation) => annotation.content)
        next = annotationsJson.next
        allPostHogAnnotations = [...allPostHogAnnotations, ...annotationNames]
    }

    let annotations = new Set(allPostHogAnnotations)

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

        const createAnnotationRes = await posthog.api.post(
            `/api/annotation/`,
            {
                host: global.posthogHost,
                data: {
                    content: tag.name,
                    scope: 'organization',
                    date_marker: getTagDate(tagDetailsJson)
                    
                }
            },
        )

        if (createAnnotationRes.status === 201) {
            posthog.capture('created_tag_annotation', { tag: tag.name })
        }
    }
    await cache.set('lastRun', new Date().getTime())
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
