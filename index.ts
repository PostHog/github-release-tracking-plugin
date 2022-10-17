export async function setupPlugin({ config, global }) {
    global.posthogHost = config.posthogHost.includes('http') ? config.posthogHost : 'https://' + config.posthogHost

    const ghBasicAuthToken = Buffer.from(`${config.ghOwner}:${config.ghToken}`).toString('base64')

    global.ghOptions = config.ghToken
        ? {
              headers: {
                  Authorization: `Basic ${ghBasicAuthToken}`
              }
          }
        : {}
}

export async function runEveryMinute({ config, global, cache }) {
    const lastRun = await cache.get('lastRun')
    if (
        lastRun &&
        new Date().getTime() - Number(lastRun) < 3600000 // 60*60*1000ms = 1 hour
    ) {
        return
    }

    let allAnnotations = []
    let nextPath = '/api/projects/@current/annotations'

    while (nextPath) {
        const annotationsRes = await posthog.api.get(nextPath, {
            host: global.posthogHost
        })

        const annotationsJson = await annotationsRes.json()
        const annotationNames: string[] = annotationsJson.results.map((annotation) => annotation.content)

        nextPath = annotationsJson.next && new URL(annotationsJson.next).pathname
        allAnnotations = [...allAnnotations, ...annotationNames]
    }

    let annotations = new Set(allAnnotations)

    const ghReleasesRes = await fetch(
        `https://api.github.com/repos/${config.ghOwner}/${config.ghRepo}/releases`,
        global.ghOptions
    )
    const ghReleasesJson = await ghReleasesRes.json()

    if (!Array.isArray(ghReleasesJson)) {
        throw new Error(`Could not load tags from Github. Response: ${JSON.stringify(ghReleasesJson)}`)
    }

    const newReleases = ghReleasesJson
        .map((release) => ({
            name: release.name,
            published_at: release.published_at
        }))
        .filter((release) => !annotations.has(release.name))

    for (let release of newReleases) {
        const createAnnotationRes = await posthog.api.post(`/api/projects/@current/annotations`, {
            host: global.posthogHost,
            data: {
                content: release.name,
                scope: 'organization',
                date_marker: release.published_at
            }
        })

        if (createAnnotationRes.status === 201) {
            posthog.capture('created_release_annotation', { release: release.name })
        } else {
            const errorMessage = await createAnnotationRes.json()

            console.error(
                'failed to create annotation',
                release.name,
                ' with status ',
                createAnnotationRes.status,
                ' and error ',
                errorMessage
            )
        }
    }

    await cache.set('lastRun', new Date().getTime())
}
