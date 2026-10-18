// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace XiHan.PrintClient.Windows.Printing;

/// <summary>
/// winspool.drv 里用到的函数、结构与常量
/// </summary>
internal static unsafe partial class Winspool
{
    public const uint PrinterEnumLocal = 0x2;
    public const uint PrinterEnumConnections = 0x4;

    public const uint PrinterAttributeNetwork = 0x10;
    public const uint PrinterAttributeWorkOffline = 0x400;

    public const ushort DcPapers = 2;
    public const ushort DcPaperSize = 3;
    public const ushort DcDuplex = 7;
    public const ushort DcPaperNames = 16;
    public const ushort DcCopies = 18;
    public const ushort DcColorDevice = 32;

    /// <summary>
    /// DC_PAPERNAMES 每个名称占的字符数
    /// </summary>
    public const int PaperNameLength = 64;

    public const uint DmOutBuffer = 2;
    public const uint DmInBuffer = 8;

    public const uint DmFieldOrientation = 0x1;
    public const uint DmFieldPaperSize = 0x2;
    public const uint DmFieldPaperLength = 0x4;
    public const uint DmFieldPaperWidth = 0x8;

    public const short DmOrientPortrait = 1;
    public const short DmOrientLandscape = 2;
    public const short DmPaperUser = 256;

    public const int ErrorFileNotFound = 2;
    public const int ErrorInsufficientBuffer = 122;
    public const int ErrorInvalidPrinterName = 1801;
    public const int ErrorInvalidDatatype = 1804;

    /// <summary>
    /// PRINTER_INFO_2
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct PrinterInfo2
    {
        public char* ServerName;
        public char* PrinterName;
        public char* ShareName;
        public char* PortName;
        public char* DriverName;
        public char* Comment;
        public char* Location;
        public void* DevMode;
        public char* SepFile;
        public char* PrintProcessor;
        public char* Datatype;
        public char* Parameters;
        public void* SecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint Jobs;
        public uint AveragePpm;
    }

    /// <summary>
    /// DEVMODEW 开头到纸张宽度为止的字段
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct DevModeHead
    {
        public fixed char DeviceName[32];
        public ushort SpecVersion;
        public ushort DriverVersion;
        public ushort Size;
        public ushort DriverExtra;
        public uint Fields;
        public short Orientation;
        public short PaperSize;
        public short PaperLength;
        public short PaperWidth;
    }

    /// <summary>
    /// DOC_INFO_1
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct DocInfo1
    {
        public char* DocName;
        public char* OutputFile;
        public char* Datatype;
    }

    [LibraryImport("winspool.drv", EntryPoint = "EnumPrintersW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool EnumPrinters(uint flags, char* name, uint level, byte* buffer, uint size, out uint needed, out uint returned);

    [LibraryImport("winspool.drv", EntryPoint = "GetDefaultPrinterW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetDefaultPrinter(char* buffer, ref uint size);

    [LibraryImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool OpenPrinter(string name, out PrinterHandle handle, void* defaults);

    [LibraryImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ClosePrinter(nint handle);

    [LibraryImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetPrinter(PrinterHandle handle, uint level, byte* buffer, uint size, out uint needed);

    [LibraryImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true)]
    public static partial uint StartDocPrinter(PrinterHandle handle, uint level, DocInfo1* info);

    [LibraryImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool StartPagePrinter(PrinterHandle handle);

    [LibraryImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool WritePrinter(PrinterHandle handle, byte* data, uint size, out uint written);

    [LibraryImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool EndPagePrinter(PrinterHandle handle);

    [LibraryImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool EndDocPrinter(PrinterHandle handle);

    [LibraryImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool AbortPrinter(PrinterHandle handle);

    [LibraryImport("winspool.drv", EntryPoint = "DeviceCapabilitiesW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial int DeviceCapabilities(string device, string? port, ushort capability, void* output, void* devMode);

    [LibraryImport("winspool.drv", EntryPoint = "DocumentPropertiesW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial int DocumentProperties(nint window, PrinterHandle printer, string device, void* output, void* input, uint mode);

    /// <summary>
    /// 读以 0 结尾的字符串；空指针与空串都为 null
    /// </summary>
    public static string? Text(char* value)
    {
        if (value == null)
            return null;
        var text = new string(value);
        return text.Length == 0 ? null : text;
    }

    /// <summary>
    /// 打印机句柄，释放时 ClosePrinter
    /// </summary>
    public sealed class PrinterHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public PrinterHandle()
            : base(ownsHandle: true)
        {
        }

        protected override bool ReleaseHandle() => ClosePrinter(handle);
    }
}
