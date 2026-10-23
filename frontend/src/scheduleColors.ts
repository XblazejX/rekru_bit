export function availabilityColor(percentage: number): string {
	const boundedPercentage = Math.min(100, Math.max(0, percentage));
	const hue = Math.round(14 + boundedPercentage * 0.78);
	const opacity = 0.15 + boundedPercentage / 310;
	return `hsl(${hue} 39% 47% / ${opacity})`;
}

export const FRIEND_AVATAR_COLORS = ['#46b6d5', '#a47be1', '#54b88b', '#e4a34e', '#e77994', '#7f99e7', '#b3a64c'];