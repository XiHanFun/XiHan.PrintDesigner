/*
 * Copyright (c) 2021-Present XiHanFun and contributors.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 */

// 这个包的版本：构建时从 package.json 取。设置对话框「关于」页写的就是它（@xihan-print 三个包锁步同版）。

import { version } from '../package.json'

/** @xihan-print/designer 的版本号。 */
export const PRINT_VERSION: string = version
