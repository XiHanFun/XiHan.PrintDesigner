/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

/** JSON 路径中的一段：对象键或数组下标。 */
export type PathSegment = string | number

/** 从文档根开始的 JSON 路径。 */
export type JsonPath = readonly PathSegment[]
