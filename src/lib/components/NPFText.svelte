<script lang="ts">
	type NpfFormat = {
		type: 'bold' | 'italic' | 'strikethrough' | 'small' | 'link' | 'mention' | 'color' | string;
		start: number;
		end: number;
		url?: string;
		blog?: { name?: string };
		hex?: string;
	};

	type TextSegment = {
		text: string;
		formats: NpfFormat[];
	};

	let { text = "", formatting = [] } = $props<{ text: string; formatting?: NpfFormat[] }>();

	// Split text into segments based on formatting boundaries
	let segments = $derived.by(() => {
		if (!formatting || formatting.length === 0) return [{ text, formats: [] }] as TextSegment[];

		const result: TextSegment[] = [];
		const points = new Set([0, text.length]);
		
		for (const fmt of formatting) {
			if (fmt.start !== undefined) points.add(fmt.start);
			if (fmt.end !== undefined) points.add(fmt.end);
		}
		
		const sortedPoints = Array.from(points).sort((a, b) => a - b);
		
		for (let i = 0; i < sortedPoints.length - 1; i++) {
			const start = sortedPoints[i];
			const end = sortedPoints[i + 1];
			if (start === end) continue;
			
			const segmentText = text.substring(start, end);
			// Find all formats that cover this segment
			const segmentFormats = formatting.filter((f: NpfFormat) => f.start <= start && f.end >= end);
			
			result.push({ text: segmentText, formats: segmentFormats });
		}
		return result;
	});
</script>

{#each segments as segment}
	{@const isBold = segment.formats.some((f) => f.type === 'bold')}
	{@const isItalic = segment.formats.some((f) => f.type === 'italic')}
	{@const isStrike = segment.formats.some((f) => f.type === 'strikethrough')}
	{@const isSmall = segment.formats.some((f) => f.type === 'small')}
	{@const linkFmt = segment.formats.find((f) => f.type === 'link')}
	{@const mentionFmt = segment.formats.find((f) => f.type === 'mention')}
	{@const colorFmt = segment.formats.find((f) => f.type === 'color')}

	<svelte:element
		this={linkFmt || mentionFmt ? 'a' : 'span'}
		href={linkFmt ? linkFmt.url : mentionFmt ? `/blog/${mentionFmt.blog?.name}` : undefined}
		target={linkFmt ? '_blank' : undefined}
		class:font-bold={isBold}
		class:italic={isItalic}
		class:line-through={isStrike}
		class:text-xs={isSmall}
		class:text-primary={mentionFmt}
		class:underline={linkFmt}
		class:hover:text-primary-focus={linkFmt || mentionFmt}
		class:transition-colors={linkFmt || mentionFmt}
		style={colorFmt ? `color: ${colorFmt.hex};` : ''}
	>{segment.text}</svelte:element>
{/each}
