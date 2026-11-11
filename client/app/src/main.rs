// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 开源版程序入口

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xihan_print_client::run(xihan_print_client::Extensions::default());
}
