// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Windows.Printing;

/// <summary>
/// 经 winspool 以 RAW 数据类型把字节原样写给打印机：OpenPrinter → StartDocPrinter → WritePrinter → EndDocPrinter
/// </summary>
public sealed unsafe class WindowsRawPrinter : IRawPrinter
{
    private const int ChunkBytes = 64 * 1024;

    /// <inheritdoc />
    public Task<long> WriteAsync(string printer, byte[] data, string documentName, CancellationToken cancellationToken)
    {
        return Task.Run(() => Write(printer, data, documentName, cancellationToken), cancellationToken);
    }

    private static long Write(string printer, byte[] data, string documentName, CancellationToken cancellationToken)
    {
        if (!Winspool.OpenPrinter(printer, out var handle, null))
        {
            var error = Marshal.GetLastPInvokeError();
            handle.Dispose();
            throw error == Winspool.ErrorInvalidPrinterName
                ? new PrintFailure(PrintErrorCodes.PrinterNotFound, $"没有这台打印机：{printer}", new JsonObject { ["printer"] = printer })
                : Failure("OpenPrinter", error);
        }
        using (handle)
        {
            fixed (char* name = documentName)
            fixed (char* datatype = "RAW")
            {
                var info = new Winspool.DocInfo1 { DocName = name, Datatype = datatype };
                if (Winspool.StartDocPrinter(handle, 1, &info) == 0)
                    throw Failure("StartDocPrinter", Marshal.GetLastPInvokeError());
            }

            var finished = false;
            try
            {
                if (!Winspool.StartPagePrinter(handle))
                    throw Failure("StartPagePrinter", Marshal.GetLastPInvokeError());
                long total = 0;
                fixed (byte* bytes = data)
                {
                    while (total < data.Length)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        var chunk = (uint)Math.Min(ChunkBytes, data.Length - total);
                        if (!Winspool.WritePrinter(handle, bytes + total, chunk, out var written))
                            throw Failure("WritePrinter", Marshal.GetLastPInvokeError());
                        if (written == 0)
                            throw Failure("WritePrinter", 0);
                        total += written;
                    }
                }
                if (!Winspool.EndPagePrinter(handle))
                    throw Failure("EndPagePrinter", Marshal.GetLastPInvokeError());
                if (!Winspool.EndDocPrinter(handle))
                    throw Failure("EndDocPrinter", Marshal.GetLastPInvokeError());
                finished = true;
                return total;
            }
            finally
            {
                if (!finished)
                    Winspool.AbortPrinter(handle);
            }
        }
    }

    /// <summary>
    /// winspool 调用失败：SPOOL_FAILED，details 带调用名与 Win32 错误码
    /// </summary>
    internal static PrintFailure Failure(string call, int error)
    {
        var message = error switch
        {
            Winspool.ErrorInvalidDatatype => "这台打印机的驱动不接受原始指令",
            0 => "打印机不再接收数据",
            _ => $"打印池调用 {call} 失败：{new System.ComponentModel.Win32Exception(error).Message}",
        };
        return new PrintFailure(PrintErrorCodes.SpoolFailed, message, new JsonObject { ["call"] = call, ["win32Error"] = error });
    }
}
