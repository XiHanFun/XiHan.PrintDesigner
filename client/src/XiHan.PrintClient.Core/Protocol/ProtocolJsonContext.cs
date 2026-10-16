// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace XiHan.PrintClient.Core.Protocol;

/// <summary>
/// 协议消息的 JSON 源生成上下文：属性名小驼峰，空值不写
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(WelcomeData))]
[JsonSerializable(typeof(PrinterInfo))]
[JsonSerializable(typeof(IReadOnlyList<PrinterInfo>))]
[JsonSerializable(typeof(JobAccepted))]
[JsonSerializable(typeof(JobStatus))]
[JsonSerializable(typeof(JobCancelled))]
[JsonSerializable(typeof(ProtocolError))]
[JsonSerializable(typeof(JsonObject))]
internal sealed partial class ProtocolJsonContext : JsonSerializerContext;
