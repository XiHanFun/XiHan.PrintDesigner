// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.ComponentModel;
using System.Runtime.InteropServices;
using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Windows.Printing;

/// <summary>
/// 经 winspool 查本机打印机：列表与状态来自 EnumPrinters / GetPrinter，能力来自 DeviceCapabilities
/// </summary>
public sealed unsafe class WindowsPrinterCatalog : IPrinterCatalog
{
    private const uint StatusPaused = 0x1;
    private const uint StatusError = 0x2;
    private const uint StatusPendingDeletion = 0x4;
    private const uint StatusPaperJam = 0x8;
    private const uint StatusPaperOut = 0x10;
    private const uint StatusPaperProblem = 0x40;
    private const uint StatusOffline = 0x80;
    private const uint StatusIoActive = 0x100;
    private const uint StatusBusy = 0x200;
    private const uint StatusPrinting = 0x400;
    private const uint StatusNotAvailable = 0x1000;
    private const uint StatusWaiting = 0x2000;
    private const uint StatusProcessing = 0x4000;
    private const uint StatusInitializing = 0x8000;
    private const uint StatusWarmingUp = 0x10000;
    private const uint StatusNoToner = 0x40000;
    private const uint StatusPagePunt = 0x80000;
    private const uint StatusUserIntervention = 0x100000;
    private const uint StatusOutOfMemory = 0x200000;
    private const uint StatusDoorOpen = 0x400000;
    private const uint StatusServerUnknown = 0x800000;
    private const uint StatusServerOffline = 0x2000000;

    private const uint OfflineBits = StatusOffline | StatusNotAvailable | StatusServerOffline;
    private const uint ErrorBits = StatusError | StatusPendingDeletion | StatusPaperProblem | StatusNoToner | StatusPagePunt | StatusUserIntervention | StatusOutOfMemory | StatusDoorOpen;
    private const uint BusyBits = StatusIoActive | StatusBusy | StatusPrinting | StatusWaiting | StatusProcessing | StatusInitializing | StatusWarmingUp;

    /// <inheritdoc />
    public IReadOnlyList<PrinterInfo> List()
    {
        var defaultName = DefaultPrinterName();
        uint count = 0;
        var buffer = Query((byte* output, uint size, out uint needed) =>
            Winspool.EnumPrinters(Winspool.PrinterEnumLocal | Winspool.PrinterEnumConnections, null, 2, output, size, out needed, out count));
        if (count == 0)
            return [];
        fixed (byte* start = buffer)
        {
            var printers = new List<PrinterInfo>((int)count);
            for (var index = 0; index < count; index++)
                printers.Add(ToInfo((Winspool.PrinterInfo2*)start + index, defaultName, capabilities: null));
            return printers;
        }
    }

    /// <inheritdoc />
    public PrinterInfo? Get(string name)
    {
        if (!Winspool.OpenPrinter(name, out var handle, null))
        {
            var error = Marshal.GetLastPInvokeError();
            handle.Dispose();
            return error == Winspool.ErrorInvalidPrinterName ? null : throw new Win32Exception(error);
        }
        using (handle)
        {
            var buffer = Query((byte* output, uint size, out uint needed) => Winspool.GetPrinter(handle, 2, output, size, out needed));
            fixed (byte* start = buffer)
            {
                var info = (Winspool.PrinterInfo2*)start;
                var printerName = Winspool.Text(info->PrinterName) ?? name;
                return ToInfo(info, DefaultPrinterName(), Capabilities(printerName, Winspool.Text(info->PortName)));
            }
        }
    }

    /// <inheritdoc />
    public string? DefaultPrinterName()
    {
        uint size = 0;
        if (!Winspool.GetDefaultPrinter(null, ref size))
        {
            var error = Marshal.GetLastPInvokeError();
            if (error == Winspool.ErrorFileNotFound)
                return null;
            if (error != Winspool.ErrorInsufficientBuffer)
                throw new Win32Exception(error);
        }
        var name = new char[size];
        fixed (char* output = name)
        {
            if (!Winspool.GetDefaultPrinter(output, ref size))
            {
                var error = Marshal.GetLastPInvokeError();
                return error == Winspool.ErrorFileNotFound ? null : throw new Win32Exception(error);
            }
            return Winspool.Text(output);
        }
    }

    /// <summary>
    /// 由 PRINTER_INFO_2 的状态位与属性位得出状态：脱机、暂停优先，其次卡纸、缺纸、出错、忙
    /// </summary>
    internal static PrinterState StateOf(uint status, uint attributes)
    {
        if ((status & OfflineBits) != 0 || (attributes & Winspool.PrinterAttributeWorkOffline) != 0)
            return PrinterState.Offline;
        if ((status & StatusPaused) != 0)
            return PrinterState.Paused;
        if ((status & StatusPaperJam) != 0)
            return PrinterState.PaperJam;
        if ((status & StatusPaperOut) != 0)
            return PrinterState.PaperOut;
        if ((status & ErrorBits) != 0)
            return PrinterState.Error;
        if ((status & BusyBits) != 0)
            return PrinterState.Busy;
        if ((status & StatusServerUnknown) != 0)
            return PrinterState.Unknown;
        return PrinterState.Ready;
    }

    /// <summary>
    /// 由驱动报的纸张号、尺寸（0.1 mm）与名称组出纸张列表；三者条数取最小
    /// </summary>
    internal static PaperInfo[] PapersOf(ReadOnlySpan<ushort> ids, ReadOnlySpan<int> sizes, ReadOnlySpan<char> names)
    {
        var count = Math.Min(ids.Length, Math.Min(sizes.Length / 2, names.Length / Winspool.PaperNameLength));
        var papers = new PaperInfo[count];
        for (var index = 0; index < count; index++)
        {
            var field = names.Slice(index * Winspool.PaperNameLength, Winspool.PaperNameLength);
            var end = field.IndexOf('\0');
            var paperName = (end < 0 ? field : field[..end]).ToString();
            papers[index] = new PaperInfo(ids[index], paperName, sizes[index * 2] / 10.0, sizes[(index * 2) + 1] / 10.0);
        }
        return papers;
    }

    private static PrinterInfo ToInfo(Winspool.PrinterInfo2* info, string? defaultName, PrinterCapabilities? capabilities)
    {
        var name = Winspool.Text(info->PrinterName) ?? string.Empty;
        return new PrinterInfo
        {
            Name = name,
            IsDefault = string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase),
            Status = StateOf(info->Status, info->Attributes),
            StatusFlags = info->Status,
            Location = Winspool.Text(info->Location),
            Comment = Winspool.Text(info->Comment),
            Driver = Winspool.Text(info->DriverName),
            Port = Winspool.Text(info->PortName),
            IsNetwork = (info->Attributes & Winspool.PrinterAttributeNetwork) != 0,
            Capabilities = capabilities,
        };
    }

    private static PrinterCapabilities Capabilities(string name, string? port)
    {
        var count = Winspool.DeviceCapabilities(name, port, Winspool.DcPapers, null, null);
        return new PrinterCapabilities
        {
            Color = Winspool.DeviceCapabilities(name, port, Winspool.DcColorDevice, null, null) == 1,
            Duplex = Winspool.DeviceCapabilities(name, port, Winspool.DcDuplex, null, null) == 1,
            MaxCopies = Math.Max(1, Winspool.DeviceCapabilities(name, port, Winspool.DcCopies, null, null)),
            Papers = count > 0 ? Papers(name, port, count) : [],
        };
    }

    private static PaperInfo[] Papers(string name, string? port, int count)
    {
        var ids = new ushort[count];
        var sizes = new int[count * 2];
        var names = new char[count * Winspool.PaperNameLength];
        fixed (ushort* idOutput = ids)
        fixed (int* sizeOutput = sizes)
        fixed (char* nameOutput = names)
        {
            var idCount = Winspool.DeviceCapabilities(name, port, Winspool.DcPapers, idOutput, null);
            var sizeCount = Winspool.DeviceCapabilities(name, port, Winspool.DcPaperSize, sizeOutput, null);
            var nameCount = Winspool.DeviceCapabilities(name, port, Winspool.DcPaperNames, nameOutput, null);
            if (idCount <= 0 || sizeCount <= 0 || nameCount <= 0)
                return [];
            return PapersOf(ids.AsSpan(0, Math.Min(idCount, count)), sizes.AsSpan(0, Math.Min(sizeCount, count) * 2), names.AsSpan(0, Math.Min(nameCount, count) * Winspool.PaperNameLength));
        }
    }

    private delegate bool QueryCall(byte* output, uint size, out uint needed);

    /// <summary>
    /// 先问要多大的缓冲，再按需分配并取回；期间缓冲需求变大时重试
    /// </summary>
    private static byte[] Query(QueryCall call)
    {
        uint size = 0;
        for (var attempt = 0; attempt < 4; attempt++)
        {
            var buffer = new byte[size];
            fixed (byte* output = buffer)
            {
                if (call(size == 0 ? null : output, size, out var needed))
                    return buffer;
                var error = Marshal.GetLastPInvokeError();
                if (error != Winspool.ErrorInsufficientBuffer)
                    throw new Win32Exception(error);
                size = needed;
            }
        }
        throw new Win32Exception(Winspool.ErrorInsufficientBuffer);
    }
}
