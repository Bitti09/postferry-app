<script lang="ts">
	import { upscaleImage } from '$lib/upscaleImage';

	let srcUrl = $state<string | null>(null);
	let originalWidth = $state(0);
	let originalHeight = $state(0);

	let targetScale = $state(3.0);
	let lanczosRadius = $state(3);
	let browserMethod = $state<'high' | 'pixelated'>('high');
	let viewZoom = $state(1.0);
	let unsharpAmount = $state(1.2);
	let unsharpRadius = $state(2.5);

	let webglContainer: HTMLDivElement;
	let canvas2dContainer: HTMLDivElement;
	let webglUnsharpContainer: HTMLDivElement;

	let loading = $state(false);
	let error = $state<string | null>(null);

	function onFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			if (srcUrl) URL.revokeObjectURL(srcUrl);
			srcUrl = URL.createObjectURL(target.files[0]);
			const img = new Image();
			img.onload = () => {
				originalWidth = img.naturalWidth;
				originalHeight = img.naturalHeight;
				doUpscale();
			};
			img.src = srcUrl;
		}
	}

	// Make sure we debounce or don't spam while sliding
	let timeout: any;
	$effect(() => {
		if (srcUrl && targetScale && lanczosRadius && browserMethod && unsharpAmount >= 0 && unsharpRadius > 0) {
			clearTimeout(timeout);
			timeout = setTimeout(doUpscale, 300);
		}
	});

	$effect(() => {
		const applyZoom = (container: HTMLDivElement) => {
			if (container && container.firstChild) {
				const c = container.firstChild as HTMLCanvasElement;
				if (c.width && c.height) {
					c.style.width = `${c.width * viewZoom}px`;
					c.style.height = `${c.height * viewZoom}px`;
				}
			}
		};
		// React to viewZoom changes
		void viewZoom;
		applyZoom(webglContainer);
		applyZoom(canvas2dContainer);
		applyZoom(webglUnsharpContainer);
	});

	async function doUpscale() {
		if (!srcUrl || !originalWidth || !originalHeight) return;
		loading = true;
		error = null;

		// Save scroll positions to prevent resetting
		const scrollT = webglContainer ? webglContainer.scrollTop : 0;
		const scrollL = webglContainer ? webglContainer.scrollLeft : 0;

		if (webglContainer) webglContainer.innerHTML = '';
		if (canvas2dContainer) canvas2dContainer.innerHTML = '';
		if (webglUnsharpContainer) webglUnsharpContainer.innerHTML = '';

		const maxW = Math.round(originalWidth * targetScale);
		const maxH = Math.round(originalHeight * targetScale);

		try {
			// Normal WebGL Lanczos
			const result = await upscaleImage(srcUrl, maxW, maxH, { radius: lanczosRadius });
			if (result && result.canvas) {
				webglContainer?.appendChild(result.canvas);
			} else {
				error = "No scaling performed (scale <= 1.0).";
			}

			// Unsharp Mask WebGL
			const resultUnsharp = await upscaleImage(srcUrl, maxW, maxH, { 
				radius: lanczosRadius, 
				unsharpAmount, 
				unsharpRadius 
			});
			if (resultUnsharp && resultUnsharp.canvas) {
				webglUnsharpContainer?.appendChild(resultUnsharp.canvas);
			}

			const c2d = document.createElement('canvas');
			c2d.width = maxW;
			c2d.height = maxH;
			const ctx = c2d.getContext('2d')!;
			ctx.imageSmoothingEnabled = browserMethod === 'high';
			if (browserMethod === 'high') {
				ctx.imageSmoothingQuality = 'high';
			}
			
			const img = new Image();
			await new Promise((resolve) => {
				img.onload = resolve;
				img.src = srcUrl!;
			});
			ctx.drawImage(img, 0, 0, maxW, maxH);
			canvas2dContainer?.appendChild(c2d);

			// Trigger a zoom apply
			setTimeout(() => {
				viewZoom = viewZoom; // re-trigger effect
				
				// Restore scroll positions after zoom is applied and DOM is updated
				requestAnimationFrame(() => {
					if (webglContainer) {
						webglContainer.scrollTop = scrollT;
						webglContainer.scrollLeft = scrollL;
					}
					if (canvas2dContainer) {
						canvas2dContainer.scrollTop = scrollT;
						canvas2dContainer.scrollLeft = scrollL;
					}
					if (webglUnsharpContainer) {
						webglUnsharpContainer.scrollTop = scrollT;
						webglUnsharpContainer.scrollLeft = scrollL;
					}
				});
			}, 0);

		} catch (err: any) {
			error = err.message || String(err);
		} finally {
			loading = false;
		}
	}
    
    // Sync scrolling
    let isSyncing = false;
    
    function onScroll(e: Event) {
        if (!isSyncing) {
            isSyncing = true;
            const target = e.target as HTMLElement;
            const st = target.scrollTop;
            const sl = target.scrollLeft;

            if (canvas2dContainer && canvas2dContainer !== target) {
                canvas2dContainer.scrollTop = st;
                canvas2dContainer.scrollLeft = sl;
            }
            if (webglContainer && webglContainer !== target) {
                webglContainer.scrollTop = st;
                webglContainer.scrollLeft = sl;
            }
            if (webglUnsharpContainer && webglUnsharpContainer !== target) {
                webglUnsharpContainer.scrollTop = st;
                webglUnsharpContainer.scrollLeft = sl;
            }

			// Slight delay to prevent ping-ponging
			requestAnimationFrame(() => {
				isSyncing = false;
			});
        }
    }
</script>

<div class="p-8 max-w-7xl mx-auto text-white flex flex-col gap-6">
	<h1 class="text-3xl font-bold">WebGL Upscaler Debug</h1>
    <p class="text-slate-400">View upscaled images side-by-side at a 1:1 pixel level to compare Lanczos-3 vs standard browser bilinear upscaling. Scroll either window to sync positions.</p>

	<div class="p-6 bg-slate-800 rounded-lg flex flex-col gap-4 shadow-lg border border-slate-700">
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
			<div class="col-span-1 md:col-span-2">
				<label class="block font-medium mb-2 text-slate-300">Upload Source Image (Small image recommended)</label>
				<input type="file" accept="image/*" onchange={onFileChange} class="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer" />
			</div>
			<div>
				<label class="block font-medium mb-2 text-slate-300 flex justify-between">
					<span>Target Scale Factor</span>
					<span class="font-bold text-indigo-400">{targetScale.toFixed(1)}x</span>
				</label>
				<input type="range" min="1.1" max="10.0" step="0.1" bind:value={targetScale} class="w-full accent-indigo-500" />
			</div>
			<div>
				<label class="block font-medium mb-2 text-slate-300 flex justify-between">
					<span>View Zoom</span>
					<span class="font-bold text-indigo-400">{viewZoom.toFixed(2)}x</span>
				</label>
				<input type="range" min="0.1" max="2.0" step="0.05" bind:value={viewZoom} class="w-full accent-indigo-500" />
			</div>
			<div>
				<label class="block font-medium mb-2 text-slate-300 flex justify-between">
					<span>Lanczos Radius</span>
					<span class="font-bold text-indigo-400">{lanczosRadius}</span>
				</label>
				<input type="range" min="2" max="5" step="1" bind:value={lanczosRadius} class="w-full accent-indigo-500" />
			</div>
			<div>
				<label class="block font-medium mb-2 text-slate-300 flex justify-between">
					<span>Unsharp Mask Amt</span>
					<span class="font-bold text-indigo-400">{unsharpAmount.toFixed(1)}</span>
				</label>
				<input type="range" min="0.0" max="3.0" step="0.1" bind:value={unsharpAmount} class="w-full accent-indigo-500" />
			</div>
			<div>
				<label class="block font-medium mb-2 text-slate-300 flex justify-between">
					<span>Unsharp Radius</span>
					<span class="font-bold text-indigo-400">{unsharpRadius.toFixed(1)}</span>
				</label>
				<input type="range" min="0.5" max="10.0" step="0.5" bind:value={unsharpRadius} class="w-full accent-indigo-500" />
			</div>
		</div>
		
		{#if originalWidth && originalHeight}
			<div class="pt-4 mt-2 border-t border-slate-700 flex justify-between items-center">
				<p class="text-sm text-slate-400">
					<span class="font-mono bg-slate-900 px-2 py-1 rounded">{originalWidth} &times; {originalHeight}</span>
					<span class="mx-2">&rarr;</span>
					<span class="font-mono bg-slate-900 px-2 py-1 rounded text-indigo-300">{Math.round(originalWidth * targetScale)} &times; {Math.round(originalHeight * targetScale)}</span>
				</p>
				{#if loading}
					<span class="text-indigo-400 animate-pulse font-medium text-sm">Processing...</span>
				{/if}
			</div>
		{/if}
	</div>

	{#if error}
		<div class="p-4 bg-red-900/50 text-red-200 rounded border border-red-800">
			{error}
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<div class="flex flex-col gap-3">
			<h2 class="text-lg font-semibold text-slate-300 flex justify-between items-center">
				<span>Browser Default</span>
				<select bind:value={browserMethod} class="text-sm bg-slate-700 border border-slate-600 rounded px-2 py-1 focus:outline-none">
					<option value="high">Bilinear</option>
					<option value="pixelated">Nearest Neighbor</option>
				</select>
			</h2>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				bind:this={canvas2dContainer} 
				onscroll={onScroll}
				class="w-full h-[55vh] bg-slate-900/80 rounded-xl overflow-auto border border-slate-700 shadow-inner flex items-start justify-start cursor-grab active:cursor-grabbing custom-scrollbar"
			>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<h2 class="text-lg font-semibold text-slate-300 flex justify-between items-center">
				<span class="text-indigo-400 font-bold">Lanczos-{lanczosRadius}</span>
			</h2>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				bind:this={webglContainer} 
				onscroll={onScroll}
				class="w-full h-[55vh] bg-slate-900/80 rounded-xl overflow-auto border border-slate-700 shadow-inner flex items-start justify-start cursor-grab active:cursor-grabbing custom-scrollbar"
			>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<h2 class="text-lg font-semibold text-slate-300 flex justify-between items-center">
				<span class="text-pink-400 font-bold">Unsharp Mask (Amt: {unsharpAmount.toFixed(1)})</span>
			</h2>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				bind:this={webglUnsharpContainer} 
				onscroll={onScroll}
				class="w-full h-[55vh] bg-slate-900/80 rounded-xl overflow-auto border border-slate-700 shadow-inner flex items-start justify-start cursor-grab active:cursor-grabbing custom-scrollbar"
			>
			</div>
		</div>
	</div>
</div>

<style>
	/* Custom scrollbar for better UI */
	.custom-scrollbar::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: rgba(15, 23, 42, 0.5); 
		border-radius: 8px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: rgba(99, 102, 241, 0.4); 
		border-radius: 8px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: rgba(99, 102, 241, 0.6); 
	}
</style>
