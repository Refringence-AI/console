// console-electron/src/main/ollama-models.ts
//
// Hardware-aware local-model guidance. Detects the machine (RAM / CPU / GPU VRAM)
// and recommends the largest reputable open model that will run WELL on it - not
// the biggest that technically loads. Pure data + a pure recommend() so the logic
// is testable without hardware. No network, no AI.
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GB = 1024 ** 3;

export interface GpuInfo { name: string; vramGB: number | null; vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown' }
export interface SystemSpecs {
    ramGB: number;
    cpuCores: number;
    cpuModel: string;
    platform: NodeJS.Platform;
    gpu: GpuInfo | null;
    /** Effective memory budget a model can use (VRAM on a discrete GPU, else RAM). */
    effectiveGB: number;
    accel: 'gpu' | 'cpu' | 'unified';
}

export interface ModelEntry {
    id: string;          // ollama tag
    label: string;
    family: string;
    params: number;      // billions
    sizeGB: number;      // q4 download size, approx
    minRamGB: number;    // to run on CPU at all
    goodGB: number;      // memory to run it comfortably (VRAM on GPU, RAM on CPU)
    license: string;
    strengths: string;
}

// Curated, reputable, permissively-or-openly licensed models. Sizes are q4_K_M
// approximations; goodGB leaves headroom for context + the OS.
export const MODEL_CATALOG: ModelEntry[] = [
    { id: 'llama3.2:1b', label: 'Llama 3.2 1B', family: 'Llama 3.2', params: 1, sizeGB: 1.3, minRamGB: 4, goodGB: 3, license: 'Llama 3.2 Community', strengths: 'tiny, instant, low-end machines' },
    { id: 'llama3.2:3b', label: 'Llama 3.2 3B', family: 'Llama 3.2', params: 3, sizeGB: 2.0, minRamGB: 6, goodGB: 4, license: 'Llama 3.2 Community', strengths: 'small + capable, fast on CPU' },
    { id: 'phi3.5:3.8b', label: 'Phi-3.5 Mini', family: 'Phi-3.5', params: 3.8, sizeGB: 2.2, minRamGB: 6, goodGB: 5, license: 'MIT', strengths: 'strong reasoning for its size' },
    { id: 'qwen2.5:7b', label: 'Qwen2.5 7B', family: 'Qwen2.5', params: 7, sizeGB: 4.7, minRamGB: 8, goodGB: 7, license: 'Apache-2.0', strengths: 'well-rounded general model' },
    { id: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', family: 'Qwen2.5 Coder', params: 7, sizeGB: 4.7, minRamGB: 8, goodGB: 7, license: 'Apache-2.0', strengths: 'coding, strong for a dev tool' },
    { id: 'llama3.1:8b', label: 'Llama 3.1 8B', family: 'Llama 3.1', params: 8, sizeGB: 4.9, minRamGB: 9, goodGB: 8, license: 'Llama 3.1 Community', strengths: 'general, widely supported' },
    { id: 'mistral:7b', label: 'Mistral 7B', family: 'Mistral', params: 7, sizeGB: 4.1, minRamGB: 8, goodGB: 6, license: 'Apache-2.0', strengths: 'fast, efficient general model' },
    { id: 'gemma2:9b', label: 'Gemma 2 9B', family: 'Gemma 2', params: 9, sizeGB: 5.4, minRamGB: 10, goodGB: 9, license: 'Gemma', strengths: 'strong quality at 9B' },
    { id: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B', family: 'Qwen2.5 Coder', params: 14, sizeGB: 9.0, minRamGB: 16, goodGB: 12, license: 'Apache-2.0', strengths: 'serious local coding' },
    { id: 'qwen2.5:14b', label: 'Qwen2.5 14B', family: 'Qwen2.5', params: 14, sizeGB: 9.0, minRamGB: 16, goodGB: 12, license: 'Apache-2.0', strengths: 'high-quality general' },
    { id: 'deepseek-coder-v2:16b', label: 'DeepSeek-Coder-V2 16B', family: 'DeepSeek-Coder-V2', params: 16, sizeGB: 8.9, minRamGB: 18, goodGB: 14, license: 'DeepSeek', strengths: 'top open coding model (MoE)' },
    { id: 'qwen2.5-coder:32b', label: 'Qwen2.5 Coder 32B', family: 'Qwen2.5 Coder', params: 32, sizeGB: 20, minRamGB: 32, goodGB: 24, license: 'Apache-2.0', strengths: 'near-frontier local coding' },
    { id: 'qwen2.5:32b', label: 'Qwen2.5 32B', family: 'Qwen2.5', params: 32, sizeGB: 20, minRamGB: 32, goodGB: 24, license: 'Apache-2.0', strengths: 'high-quality large general' },
    { id: 'llama3.1:70b', label: 'Llama 3.1 70B', family: 'Llama 3.1', params: 70, sizeGB: 40, minRamGB: 64, goodGB: 48, license: 'Llama 3.1 Community', strengths: 'maximum local quality' },
];

async function detectGpu(platform: NodeJS.Platform): Promise<GpuInfo | null> {
    // NVIDIA: nvidia-smi gives accurate VRAM.
    try {
        const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true });
        const line = stdout.split('\n').map((l) => l.trim()).filter(Boolean)[0];
        if (line) {
            const [name, mem] = line.split(',').map((s) => s.trim());
            const vramGB = Number(mem) > 0 ? Math.round((Number(mem) / 1024) * 10) / 10 : null;
            return { name: name || 'NVIDIA GPU', vramGB, vendor: 'nvidia' };
        }
    } catch { /* no nvidia-smi */ }

    if (platform === 'darwin') {
        // Apple Silicon shares unified memory; report the chip, VRAM is the RAM budget.
        const cpu = os.cpus()[0]?.model ?? '';
        if (/Apple/i.test(cpu)) return { name: cpu, vramGB: null, vendor: 'apple' };
    }

    if (platform === 'win32') {
        // Name only (Win32 AdapterRAM is unreliable for >4 GB cards); VRAM stays null
        // so the recommendation falls back to a safe RAM-based budget.
        try {
            const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)"], { timeout: 5000, windowsHide: true });
            const name = stdout.trim().split('\n')[0]?.trim();
            if (name) {
                const vendor: GpuInfo['vendor'] = /nvidia/i.test(name) ? 'nvidia' : /amd|radeon/i.test(name) ? 'amd' : /intel/i.test(name) ? 'intel' : 'unknown';
                return { name, vramGB: null, vendor };
            }
        } catch { /* no powershell / blocked */ }
    }
    return null;
}

export async function detectSystemSpecs(): Promise<SystemSpecs> {
    const ramGB = Math.round((os.totalmem() / GB) * 10) / 10;
    const cpus = os.cpus();
    const platform = process.platform;
    const gpu = await detectGpu(platform);

    let accel: SystemSpecs['accel'] = 'cpu';
    let effectiveGB = ramGB;
    if (gpu?.vendor === 'apple') { accel = 'unified'; effectiveGB = ramGB; }
    else if (gpu && typeof gpu.vramGB === 'number' && gpu.vramGB >= 4) { accel = 'gpu'; effectiveGB = gpu.vramGB; }
    // A discrete GPU with unknown VRAM: stay on the RAM budget (honest, never over-promise).

    return { ramGB, cpuCores: cpus.length, cpuModel: cpus[0]?.model?.trim() ?? 'Unknown CPU', platform, gpu, effectiveGB, accel };
}

export type Fit = 'good' | 'tight' | 'too-big';
export interface AnnotatedModel extends ModelEntry { fit: Fit; recommended: boolean; installed: boolean }
export interface Recommendation {
    specs: SystemSpecs;
    recommendedId: string | null;
    reason: string;
    models: AnnotatedModel[];
}

// Comfortable budget: on a GPU the model should fit in ~90% of VRAM; on CPU/unified
// memory leave the OS room and use ~55% of RAM (model + context + everything else).
function budgetGB(specs: SystemSpecs): number {
    return specs.accel === 'gpu' ? specs.effectiveGB * 0.9 : specs.ramGB * 0.55;
}

export function recommend(specs: SystemSpecs, installed: string[] = []): Recommendation {
    const budget = budgetGB(specs);
    const have = new Set(installed.map((m) => m.toLowerCase()));
    const fitOf = (m: ModelEntry): Fit => {
        if (m.goodGB <= budget) return 'good';
        if (m.minRamGB <= (specs.accel === 'gpu' ? specs.ramGB : specs.ramGB)) return 'tight';
        return 'too-big';
    };
    // Largest model that runs comfortably; prefer a coder model at the same size
    // for a dev tool. Fall back to the smallest if nothing is comfortable.
    const good = MODEL_CATALOG.filter((m) => fitOf(m) === 'good');
    let pick: ModelEntry | null = null;
    if (good.length > 0) {
        const maxParams = Math.max(...good.map((m) => m.params));
        const top = good.filter((m) => m.params === maxParams);
        pick = top.find((m) => /coder/i.test(m.family)) ?? top[0];
    } else {
        pick = MODEL_CATALOG[0]; // smallest, always runnable
    }
    const reason = good.length > 0
        ? specs.accel === 'gpu'
            ? `Fits comfortably in your ${specs.gpu?.name ?? 'GPU'} (${specs.effectiveGB} GB VRAM).`
            : `Runs on ${specs.ramGB} GB RAM on the CPU. A supported GPU would let you run a larger model faster.`
        : `Your machine is tight on memory, so the smallest model is the safe choice.`;

    const models: AnnotatedModel[] = MODEL_CATALOG.map((m) => ({
        ...m, fit: fitOf(m), recommended: m.id === pick?.id, installed: have.has(m.id.toLowerCase()),
    }));
    return { specs, recommendedId: pick?.id ?? null, reason, models };
}
