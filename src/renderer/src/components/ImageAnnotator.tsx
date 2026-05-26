import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Canvas, Rect, Circle, Line, IText, FabricImage, FabricObject } from 'fabric'
import type { Annotation } from '../types/message'

type AnnotationTool = 'rect' | 'circle' | 'arrow' | 'text' | 'select'

interface ImageAnnotatorProps {
  src: string
  alt?: string
  annotations: Annotation[]
  onAnnotationsChange: (annotations: Annotation[]) => void
  isActive: boolean
}

export interface ImageAnnotatorHandle {
  getAnnotatedImage: () => { dataUrl: string; description: string } | null
}

export const ImageAnnotator = forwardRef<ImageAnnotatorHandle, ImageAnnotatorProps>(
  function ImageAnnotator({ src, alt, annotations, onAnnotationsChange, isActive }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const fabricRef = useRef<Canvas | null>(null)
    const imgRef = useRef<HTMLImageElement | null>(null)
    const scaleRef = useRef<number>(1)
    const [activeTool, setActiveTool] = useState<AnnotationTool>('rect')
    const [isDrawing, setIsDrawing] = useState(false)
    const drawStartRef = useRef<{ x: number; y: number } | null>(null)
    const currentShapeRef = useRef<FabricObject | null>(null)

    useImperativeHandle(ref, () => ({
      getAnnotatedImage: () => {
        const canvas = fabricRef.current
        if (!canvas) return null

        const dataUrl = canvas.toDataURL({ format: 'png' })
        const description = annotationsToPrompt(annotations, alt ?? 'image')
        return { dataUrl, description }
      }
    }), [annotations, alt])

    useEffect(() => {
      if (!isActive || !canvasRef.current || !containerRef.current) return

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        imgRef.current = img
        const containerWidth = containerRef.current!.clientWidth
        const scale = containerWidth / img.width
        scaleRef.current = scale
        const displayWidth = containerWidth
        const displayHeight = img.height * scale

        const canvas = new Canvas(canvasRef.current!, {
          width: displayWidth,
          height: displayHeight,
          selection: false,
        })

        // Fabric v6 uses FabricImage.fromURL instead of v5's canvas.setBackgroundImage()
        FabricImage.fromURL(src, { crossOrigin: 'anonymous' }).then((fabricImg) => {
          fabricImg.set({
            scaleX: scale,
            scaleY: scale,
            originX: 'left',
            originY: 'top',
          })
          canvas.backgroundImage = fabricImg
          canvas.renderAll()
        }).catch(() => {
          FabricImage.fromURL(src).then((fabricImg) => {
            fabricImg.set({
              scaleX: scale,
              scaleY: scale,
              originX: 'left',
              originY: 'top',
            })
            canvas.backgroundImage = fabricImg
            canvas.renderAll()
          })
        })

        fabricRef.current = canvas
      }
      img.src = src

      return () => {
        const canvas = fabricRef.current
        if (canvas) {
          canvas.dispose()
          fabricRef.current = null
        }
      }
    }, [isActive, src])

    useEffect(() => {
      const canvas = fabricRef.current
      if (!canvas || !isActive) return

      const onMouseDown = (opt: { e: MouseEvent }) => {
        if (activeTool === 'select') return
        const point = getCanvasPoint(opt.e)
        if (!point) return

        setIsDrawing(true)
        drawStartRef.current = point

        let shape: FabricObject

        switch (activeTool) {
          case 'rect':
            shape = new Rect({
              left: point.x,
              top: point.y,
              width: 0,
              height: 0,
              fill: 'transparent',
              stroke: '#ef4444',
              strokeWidth: 2,
              strokeUniform: true,
            })
            break
          case 'circle':
            shape = new Circle({
              left: point.x,
              top: point.y,
              radius: 0,
              fill: 'transparent',
              stroke: '#ef4444',
              strokeWidth: 2,
              strokeUniform: true,
            })
            break
          case 'arrow':
            shape = new Line([point.x, point.y, point.x, point.y], {
              stroke: '#ef4444',
              strokeWidth: 2,
              strokeUniform: true,
            })
            break
          case 'text':
            shape = new IText('Label', {
              left: point.x,
              top: point.y,
              fontSize: 16,
              fill: '#ef4444',
              fontFamily: 'sans-serif',
            })
            canvas.add(shape)
            canvas.setActiveObject(shape)
            setIsDrawing(false)
            drawStartRef.current = null
            return
          default:
            return
        }

        canvas.add(shape)
        currentShapeRef.current = shape
      }

      const onMouseMove = (opt: { e: MouseEvent }) => {
        if (!isDrawing || !drawStartRef.current || !currentShapeRef.current || !fabricRef.current) return
        const point = getCanvasPoint(opt.e)
        if (!point) return

        const shape = currentShapeRef.current
        const start = drawStartRef.current

        if (shape instanceof Rect) {
          const left = Math.min(start.x, point.x)
          const top = Math.min(start.y, point.y)
          shape.set({
            left,
            top,
            width: Math.abs(point.x - start.x),
            height: Math.abs(point.y - start.y),
          })
        } else if (shape instanceof Circle) {
          const radius = Math.sqrt(
            Math.pow(point.x - start.x, 2) + Math.pow(point.y - start.y, 2)
          ) / 2
          shape.set({
            left: (start.x + point.x) / 2 - radius,
            top: (start.y + point.y) / 2 - radius,
            radius,
          })
        } else if (shape instanceof Line) {
          shape.set({ x2: point.x, y2: point.y })
        }

        fabricRef.current.renderAll()
      }

      const onMouseUp = () => {
        setIsDrawing(false)
        drawStartRef.current = null
        currentShapeRef.current = null
        exportAnnotations()
      }

      canvas.on('mouse:down', onMouseDown)
      canvas.on('mouse:move', onMouseMove)
      canvas.on('mouse:up', onMouseUp)

      canvas.selection = activeTool === 'select'
      canvas.defaultCursor = activeTool === 'select' ? 'default' : 'crosshair'

      canvas.getObjects().forEach((obj) => {
        obj.selectable = activeTool === 'select'
        obj.evented = activeTool === 'select'
      })

      return () => {
        canvas.off('mouse:down', onMouseDown)
        canvas.off('mouse:move', onMouseMove)
        canvas.off('mouse:up', onMouseUp)
      }
    }, [isActive, activeTool, isDrawing])

    const getCanvasPoint = useCallback((e: MouseEvent) => {
      const canvas = fabricRef.current
      if (!canvas) return null
      const pointer = canvas.getScenePoint(e)
      return { x: pointer.x, y: pointer.y }
    }, [])

    const exportAnnotations = useCallback(() => {
      const canvas = fabricRef.current
      if (!canvas) return

      const img = imgRef.current
      if (!img) return

      const scaleX = img.width / canvas.width
      const scaleY = img.height / canvas.height

      const newAnnotations: Annotation[] = []
      const objects = canvas.getObjects()

      for (const obj of objects) {
        const normX = (obj.left ?? 0) * scaleX / img.width
        const normY = (obj.top ?? 0) * scaleY / img.height

        if (obj instanceof Rect) {
          newAnnotations.push({
            id: crypto.randomUUID(),
            type: 'rect',
            coords: [
              normX,
              normY,
              (obj.width ?? 0) * scaleX / img.width,
              (obj.height ?? 0) * scaleY / img.height,
            ],
            color: obj.stroke as string,
          })
        } else if (obj instanceof Circle) {
          newAnnotations.push({
            id: crypto.randomUUID(),
            type: 'circle',
            coords: [
              normX,
              normY,
              ((obj.radius ?? 0) * 2 * scaleX) / img.width,
            ],
            color: obj.stroke as string,
          })
        } else if (obj instanceof Line) {
          const x2 = ((obj.x2 ?? 0) * scaleX) / img.width
          const y2 = ((obj.y2 ?? 0) * scaleY) / img.height
          newAnnotations.push({
            id: crypto.randomUUID(),
            type: 'arrow',
            coords: [normX, normY, x2, y2],
            color: obj.stroke as string,
          })
        } else if (obj instanceof IText) {
          newAnnotations.push({
            id: crypto.randomUUID(),
            type: 'text',
            coords: [normX, normY],
            label: obj.text ?? '',
            color: obj.fill as string,
          })
        }
      }

      onAnnotationsChange(newAnnotations)
    }, [onAnnotationsChange])

    const handleClear = useCallback(() => {
      const canvas = fabricRef.current
      if (!canvas) return
      canvas.clear()
      const img = imgRef.current
      if (img) {
        FabricImage.fromURL(src).then((fabricImg) => {
          fabricImg.set({
            scaleX: scaleRef.current,
            scaleY: scaleRef.current,
            originX: 'left',
            originY: 'top',
          })
          canvas.backgroundImage = fabricImg
          canvas.renderAll()
        })
      }
      onAnnotationsChange([])
    }, [src, onAnnotationsChange])

    if (!isActive) {
      return null
    }

    return (
      <div ref={containerRef} className="relative">
        <div className="absolute top-2 left-2 z-10 flex gap-1 rounded bg-gray-900/90 p-1">
          {(['select', 'rect', 'circle', 'arrow', 'text'] as AnnotationTool[]).map((tool) => (
            <button
              key={tool}
              onClick={() => setActiveTool(tool)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                activeTool === tool
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {tool === 'select' ? 'Select' : tool === 'rect' ? 'Rect' : tool === 'circle' ? 'Circle' : tool === 'arrow' ? 'Arrow' : 'Text'}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="rounded bg-red-700 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
          >
            Clear
          </button>
        </div>
        <canvas ref={canvasRef} />
      </div>
    )
  }
)

function annotationsToPrompt(annotations: Annotation[], imageContext: string): string {
  if (annotations.length === 0) return `User annotated "${imageContext}" with no specific markings.`

  const parts = annotations.map((a) => {
    const pos = `position [${a.coords.map((c) => Math.round(c * 100))}%]`
    switch (a.type) {
      case 'rect':
        return `${pos} drew a rectangle${a.label ? `, labeled: "${a.label}"` : ''}`
      case 'circle':
        return `${pos} drew a circle${a.label ? `, labeled: "${a.label}"` : ''}`
      case 'arrow':
        return `${pos} drew an arrow${a.label ? `, labeled: "${a.label}"` : ''}`
      case 'text':
        return `${pos} wrote: "${a.label ?? ''}"`
    }
  })

  return `User annotated "${imageContext}":\n${parts.join('\n')}`
}

export { annotationsToPrompt }
