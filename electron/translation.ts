export function serviceError(status: number, service: string): string {
  if (status === 401 || status === 403)
    return `${service} 密钥无效或没有访问权限，请检查设置。`;
  if (status === 429) return `${service} 请求过于频繁，请稍后重试。`;
  if (status === 456 || status === 402)
    return `${service} 额度已用尽，请检查服务账户。`;
  return `${service} 服务暂时不可用（${status}），请重试。`;
}
