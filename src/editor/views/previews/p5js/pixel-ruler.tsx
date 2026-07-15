import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import "./pixel-ruler.css"

export interface PixelRulerHandle {
    showCursorAt(sketchCoord: number): void
    hideCursor():                      void
}

interface PixelRulerProps {
    orientation: 'horizontal' | 'vertical'
    thickness:   number
    scaleFactor: number | undefined
    origin:      number | undefined
    sketchSize:  number | undefined
}

const minTickSpacingPx = 4
const labelOffsetPx    = 3

function drawRuler(canvas: HTMLCanvasElement, orientation: 'horizontal' | 'vertical', length: number, thickness: number, scaleFactor: number | undefined, origin: number | undefined, sketchSize: number | undefined): void {

    const dpr    = window.devicePixelRatio || 1
    const width  = orientation === 'horizontal' ? length : thickness
    const height = orientation === 'horizontal' ? thickness : length

    canvas.width       = Math.max(1, Math.round(width * dpr))
    canvas.height      = Math.max(1, Math.round(height * dpr))
    canvas.style.width  = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) { return }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const styles    = getComputedStyle(canvas.parentElement ?? canvas)
    const bgColor   = styles.getPropertyValue('--ruler-bg').trim()   || '#f3f3f3'
    const tickColor = styles.getPropertyValue('--ruler-tick').trim() || '#cccccc'
    const textColor = styles.getPropertyValue('--ruler-text').trim() || '#666666'

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)

    if (scaleFactor === undefined || origin === undefined || !sketchSize || sketchSize <= 0 || length <= 0) { return }

    const drawMinor  = 10 * scaleFactor >= minTickSpacingPx
    const drawMedium = 50 * scaleFactor >= minTickSpacingPx

    ctx.font          = '9px sans-serif'
    ctx.textBaseline  = 'top'
    ctx.textAlign     = 'left'

    for (let coord = 0; coord <= sketchSize; coord += 10) {

        const isMajor  = coord % 100 === 0
        const isMedium = !isMajor && coord % 50 === 0

        if (!isMajor && !isMedium && !drawMinor) { continue }
        if (isMedium && !drawMedium)              { continue }

        const screenPos = origin + coord * scaleFactor
        if (screenPos < -1 || screenPos > length + 1) { continue }

        const tickLength = isMajor ? thickness * 0.55 : isMedium ? thickness * 0.35 : thickness * 0.2

        ctx.strokeStyle = tickColor
        ctx.lineWidth   = 1
        ctx.beginPath()

        if (orientation === 'horizontal') {
            ctx.moveTo(screenPos + 0.5, thickness)
            ctx.lineTo(screenPos + 0.5, thickness - tickLength)
        } else {
            ctx.moveTo(thickness, screenPos + 0.5)
            ctx.lineTo(thickness - tickLength, screenPos + 0.5)
        }

        ctx.stroke()

        if (isMajor && coord > 0) {
            ctx.fillStyle = textColor
            if (orientation === 'horizontal') {
                ctx.fillText(String(coord), screenPos + 2, 2)
            } else {
                ctx.save()
                ctx.translate(2, screenPos + 2)
                ctx.rotate(-Math.PI / 2)
                ctx.fillText(String(coord), 0, 0)
                ctx.restore()
            }
        }
    }
}

const PixelRuler = forwardRef<PixelRulerHandle, PixelRulerProps>(({ orientation, thickness, scaleFactor, origin, sketchSize }, ref) => {

    const wrapperRef   = useRef<HTMLDivElement | null>(null)
    const canvasRef    = useRef<HTMLCanvasElement | null>(null)
    const indicatorRef = useRef<HTMLDivElement | null>(null)
    const labelRef     = useRef<HTMLDivElement | null>(null)

    const [length, setLength] = useState<number>(0)
    const [colorSchemeTick, setColorSchemeTick] = useState<number>(0)

    useImperativeHandle(ref, () => ({
        showCursorAt(sketchCoord: number) {
            const indicator = indicatorRef.current
            const label     = labelRef.current
            if (!indicator || !label || scaleFactor === undefined || origin === undefined) { return }

            const screenPos = origin + sketchCoord * scaleFactor

            if (orientation === 'horizontal') {
                indicator.style.transform = `translateX(${screenPos}px)`
                label.style.transform     = `translateX(${screenPos + labelOffsetPx}px)`
            } else {
                indicator.style.transform = `translateY(${screenPos}px)`
                label.style.transform     = `translateY(${screenPos + labelOffsetPx}px)`
            }

            indicator.style.opacity = '1'
            label.style.opacity     = '1'
            label.textContent       = String(Math.round(sketchCoord))
        },
        hideCursor() {
            if (indicatorRef.current) { indicatorRef.current.style.opacity = '0' }
            if (labelRef.current)     { labelRef.current.style.opacity     = '0' }
        }
    }), [orientation, scaleFactor, origin])

    useEffect(() => {
        const wrapper = wrapperRef.current
        if (!wrapper) { return }

        const observer = new ResizeObserver(() => {
            const rect = wrapper.getBoundingClientRect()
            setLength(orientation === 'horizontal' ? rect.width : rect.height)
        })
        observer.observe(wrapper)

        return () => observer.disconnect()
    }, [orientation])

    useEffect(() => {
        const media    = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = () => setColorSchemeTick(tick => tick + 1)
        media.addEventListener('change', onChange)
        return () => media.removeEventListener('change', onChange)
    }, [])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) { return }
        drawRuler(canvas, orientation, length, thickness, scaleFactor, origin, sketchSize)
        // colorSchemeTick has no direct effect on drawRuler's inputs -- it only forces a repaint so a
        // live OS theme change is reflected even when nothing else about the layout changed at the same time
    }, [orientation, length, thickness, scaleFactor, origin, sketchSize, colorSchemeTick])

    return (
        <div ref={wrapperRef} className={`pixel-ruler pixel-ruler--${orientation}`}>
            <canvas ref={canvasRef} />
            <div ref={indicatorRef} className="pixel-ruler__indicator" />
            <div ref={labelRef} className="pixel-ruler__label" />
        </div>
    )
})

PixelRuler.displayName = 'PixelRuler'

export default PixelRuler
