/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** 每段转换的字节数，免得展开参数过多。 */
const CHUNK = 0x8000

/** 字节转成 base64。 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  return btoa(binary)
}
