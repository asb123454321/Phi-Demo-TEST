my $bpm = shift(@ARGV) // 150;
my $k = $bpm/60;
open F,"<:utf8","c.txt"; my @out; my $n=0; my $fixed=0;
while(<F>){
  s/\x{feff}//g; s/\r//g; next unless /\S/;
  my @p=split;
  my ($tag,$line,$t1,$t2,$x,$side,$fake)=@p[0..6];
  # 原文件部分 n1 行缺 fake 列（只有 6 列），补齐为 0
  if(!defined $fake || $fake !~ /^-?\d+$/) { $fake = 0; $fixed++; }
  next unless $tag =~ /^n[1-4]$/;
  my $px=$x*115.2;
  my $pxs=sprintf("%.3f",$px); $pxs=~s/0+$//; $pxs=~s/\.$//; $pxs="0" if $pxs eq "-0";
  my $b1s=sprintf("%.3f",$t1*$k); $b1s=~s/0+$//; $b1s=~s/\.$//;
  my $row;
  if($tag eq "n2"){
    my $b2s=sprintf("%.3f",$t2*$k); $b2s=~s/0+$//; $b2s=~s/\.$//;
    $row="$tag $line $b1s $b2s $pxs $side 0";
  } else {
    $row="$tag $line $b1s $pxs $side 0";
  }
  push @out,$row; $n++;
}
print STDERR "notes $n, bpm $bpm, x*115.2, t*$k, 补齐 fake 列 $fixed 行\n";
print "# bpm $bpm\nbp 0 $bpm\n";
print map {"$_\n"} @out;
