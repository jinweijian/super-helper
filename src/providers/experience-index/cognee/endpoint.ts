export function resolveCogneeSearchEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/search`;
}

export function resolveCogneeEndpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/${suffix.replace(/^\/+/, '')}`;
}
