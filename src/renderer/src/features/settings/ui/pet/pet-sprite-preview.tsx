import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { CODEX_PET_ANIMATIONS, CODEX_PET_ATLAS, type PetAsset } from '@shared/pet'
import { isPetApiAvailable, petClient } from '@/platform/electron/pet-client'

const assetCache = new Map<string, PetAsset>()

async function loadAsset(id: string): Promise<PetAsset | null> {
  const cached = assetCache.get(id)
  if (cached) return cached
  if (!isPetApiAvailable()) return null
  try {
    const asset = await petClient.get(id)
    if (asset) assetCache.set(id, asset)
    return asset
  } catch {
    return null
  }
}

interface PetSpritePreviewProps {
  petId: string
}

export function PetSpritePreview({ petId }: PetSpritePreviewProps): React.JSX.Element {
  const [asset, setAsset] = useState<PetAsset | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadAsset(petId).then((loaded) => {
      if (!cancelled) setAsset(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [petId])

  if (!asset) return <div className="size-full" />

  const idleRow = CODEX_PET_ANIMATIONS.idle.row
  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    backgroundImage: `url(${asset.spritesheetDataUrl})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${CODEX_PET_ATLAS.columns * 100}% ${CODEX_PET_ATLAS.rows * 100}%`,
    backgroundPosition: `0% ${(idleRow / (CODEX_PET_ATLAS.rows - 1)) * 100}%`,
    imageRendering: 'pixelated'
  }

  return <div style={style} />
}
