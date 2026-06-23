export function printQualitySummary(result: {
  qualityReportPath?: string;
  sourceQualityReportPath?: string;
  qualityGateResult?: { passed: boolean; reason?: string };
  qualitySeverityCounts?: Record<string, number>;
  qualityIssueCounts?: Record<string, number>;
}): void {
  if (result.qualityGateResult?.reason === 'quality gate disabled') {
    console.log('quality audit skipped (gate=off)');
    return;
  }
  if (result.qualityReportPath) console.log(`quality report: ${result.qualityReportPath}`);
  if (result.sourceQualityReportPath) console.log(`source quality report: ${result.sourceQualityReportPath}`);
  if (result.qualitySeverityCounts) {
    console.log(`severity: error=${result.qualitySeverityCounts.error ?? 0} warn=${result.qualitySeverityCounts.warn ?? 0} info=${result.qualitySeverityCounts.info ?? 0}`);
  }
  if (result.qualityIssueCounts) {
    const topIssues = Object.entries(result.qualityIssueCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([code, count]) => `${code}=${count}`)
      .join(', ');
    if (topIssues) console.log(`top issues: ${topIssues}`);
  }
}
