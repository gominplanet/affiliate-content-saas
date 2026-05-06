// Hostinger API service
// Docs: https://developers.hostinger.com
// API key: hPanel → Account → API → Generate token

// VPS API only — shared hosting plans do not support API-based WordPress installation
const BASE = 'https://developers.hostinger.com/api/vps/v1'

export interface HostingerSubscription {
  id: string
  plan: string
  status: string
  domain: string
  expiresAt: string
}

export interface HostingerVhost {
  id: string
  domain: string
  isPrimary: boolean
  wordpressInstalled: boolean
}

export interface WordPressInstallResult {
  jobId: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  adminUrl?: string
  adminEmail?: string
  adminPassword?: string
}

export class HostingerService {
  constructor(private apiKey: string) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authentication: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Hostinger API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async getSubscriptions(): Promise<HostingerSubscription[]> {
    const data = await this.request<{ data: HostingerSubscription[] }>('/hosting/subscriptions')
    return data.data ?? []
  }

  async getVhosts(subscriptionId: string): Promise<HostingerVhost[]> {
    const data = await this.request<{ data: HostingerVhost[] }>(
      `/hosting/subscriptions/${subscriptionId}/vhosts`,
    )
    return data.data ?? []
  }

  async installWordPress(
    subscriptionId: string,
    vhostId: string,
    opts: { adminEmail: string; adminPassword: string; adminUser: string; siteTitle: string },
  ): Promise<WordPressInstallResult> {
    return this.request<WordPressInstallResult>(
      `/hosting/subscriptions/${subscriptionId}/applications`,
      {
        method: 'POST',
        body: JSON.stringify({
          application: 'wordpress',
          vhost_id: vhostId,
          admin_email: opts.adminEmail,
          admin_password: opts.adminPassword,
          admin_user: opts.adminUser,
          site_title: opts.siteTitle,
        }),
      },
    )
  }

  async getInstallStatus(subscriptionId: string, jobId: string): Promise<WordPressInstallResult> {
    return this.request<WordPressInstallResult>(
      `/hosting/subscriptions/${subscriptionId}/applications/${jobId}`,
    )
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.getSubscriptions()
      return true
    } catch {
      return false
    }
  }
}

export function createHostingerService(apiKey: string) {
  return new HostingerService(apiKey)
}
