export interface PageSpeedLite {
  lighthouseResult: {
    categories: { performance: { score: number | null } }
    audits: Record<string, { displayValue?: string }>
  }
}

function stubResult(): PageSpeedLite {
  return {
    lighthouseResult: {
      categories: { performance: { score: 0.9 } },
      audits: {
        'largest-contentful-paint': { displayValue: '1.2 s' },
        'first-contentful-paint': { displayValue: '0.8 s' },
        'cumulative-layout-shift': { displayValue: '0.05' },
        'total-blocking-time': { displayValue: '120 ms' },
        interactive: { displayValue: '2.1 s' },
        'speed-index': { displayValue: '1.9 s' },
      },
    },
  }
}

export const pagespeedMcp = {
  async analyze(url: string, strategy: 'mobile' | 'desktop'): Promise<PageSpeedLite> {
    const key =
      process.env.PAGESPEED_API_KEY?.trim() ||
      process.env.GOOGLE_PSI_API_KEY?.trim() ||
      ''
    if (!key) {
      return stubResult()
    }
    const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
    u.searchParams.set('url', url)
    u.searchParams.set('key', key)
    u.searchParams.set('strategy', strategy)
    const res = await fetch(u.toString())
    if (!res.ok) throw new Error(`PageSpeed API ${res.status}`)
    return (await res.json()) as PageSpeedLite
  },
}
