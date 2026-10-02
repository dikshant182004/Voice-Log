import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const bufferLength = analyser ? analyser.frequencyBinCount : 32;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animId = requestAnimationFrame(render);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (!isActive || !analyser) {
        // Flat quiet baseline
        ctx.strokeStyle = '#e5e5e5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      const barCount = 32;
      const barWidth = (width / barCount) - 2;
      let x = 0;

      for (let i = 0; i < barCount; i++) {
        // Average chunk
        const step = Math.floor(bufferLength / barCount);
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += dataArray[i * step + j];
        }
        const avg = sum / step;
        const barHeight = Math.max(3, (avg / 255) * height * 0.9);

        ctx.fillStyle = '#059669'; // Emerald accent
        ctx.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
        x += barWidth + 2;
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [analyser, isActive]);

  return (
    <div className="w-full flex items-center justify-center py-2">
      <canvas
        ref={canvasRef}
        width={360}
        height={50}
        className="w-full max-w-sm h-12 bg-neutral-50 rounded-lg border border-neutral-200"
      />
    </div>
  );
};
